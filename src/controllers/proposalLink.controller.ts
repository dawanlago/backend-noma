import crypto from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { isValidObjectId, type Types } from "mongoose";
import ProposalLink, { type IProposalLink } from "../models/ProposalLink";
import ProposalView from "../models/ProposalView";
import ToolDocument from "../models/ToolDocument";
import { recordScope } from "../lib/ownership";
import { hasModule } from "../lib/permissions";
import {
  MAX_VIEWS_PER_HOUR,
  SESSION_WINDOW_MS,
  clampDuration,
  parseBody,
  summarizeUserAgent,
} from "../lib/proposalViews";
import { TOOL_MODULES } from "../types";

/* Link público da proposta (/p/<token>) e o rastreio de quando/quanto o cliente visualizou. */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const UNAVAILABLE = "Este link de proposta não está mais disponível.";

/** O sendBeacon envia `text/plain` (evita preflight de CORS); o JSON é lido em `parseBody`. */
export const beaconBody = express.text({ type: "text/plain", limit: "2kb" });

function newToken() {
  return crypto.randomBytes(18).toString("base64url");
}

/** Proposta que o usuário pode ver/alterar (mesmas regras de dono das ferramentas). */
async function ownedProposal(req: Request, res: Response) {
  if (!hasModule(req.user!, TOOL_MODULES.proposal)) {
    res.status(403).json({ error: "Seu usuário não tem acesso a esta ferramenta." });
    return null;
  }
  const doc = isValidObjectId(req.params.id)
    ? await ToolDocument.findOne({ _id: req.params.id, tool: "proposal", ...recordScope(req) }).select("_id ownerId").lean()
    : null;
  if (!doc) {
    res.status(404).json({ error: "Proposta não encontrada." });
    return null;
  }
  return doc;
}

/** Link, totais e sessões de visualização de uma proposta. */
async function shareInfo(documentId: Types.ObjectId, link: IProposalLink | null) {
  const [totals] = await ProposalView.aggregate<{
    views: number;
    totalSeconds: number;
    firstViewedAt: Date;
    lastViewedAt: Date;
  }>([
    { $match: { documentId } },
    {
      $group: {
        _id: null,
        views: { $sum: 1 },
        totalSeconds: { $sum: "$durationSeconds" },
        firstViewedAt: { $min: "$openedAt" },
        lastViewedAt: { $max: "$lastSeenAt" },
      },
    },
  ]);
  const sessions = await ProposalView.find({ documentId })
    .select("openedAt lastSeenAt durationSeconds device os browser")
    .sort({ openedAt: -1 })
    .limit(100)
    .lean();
  return {
    link: link ? { token: link.token, isActive: link.isActive, createdAt: link.createdAt } : null,
    stats: {
      views: totals?.views || 0,
      totalSeconds: totals?.totalSeconds || 0,
      firstViewedAt: totals?.firstViewedAt || null,
      lastViewedAt: totals?.lastViewedAt || null,
    },
    sessions,
  };
}

/** GET /tools/proposal/documents/:id/share */
export async function getProposalShare(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedProposal(req, res);
    if (!doc) return;
    const link = await ProposalLink.findOne({ documentId: doc._id });
    res.json({ data: await shareInfo(doc._id, link) });
  } catch (error) {
    next(error);
  }
}

/** POST /tools/proposal/documents/:id/share { regenerate? } — cria, reativa ou troca o link. */
export async function createProposalShare(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedProposal(req, res);
    if (!doc) return;
    let link = await ProposalLink.findOne({ documentId: doc._id });
    if (!link) {
      link = await ProposalLink.create({ token: newToken(), documentId: doc._id, ownerId: doc.ownerId });
    } else {
      // Gerar um novo link invalida o anterior; o histórico de visualizações continua.
      if (req.body?.regenerate === true) link.token = newToken();
      link.isActive = true;
      await link.save();
    }
    res.status(201).json({ data: await shareInfo(doc._id, link) });
  } catch (error) {
    next(error);
  }
}

/** DELETE /tools/proposal/documents/:id/share — desativa o link (o cliente deixa de acessar). */
export async function disableProposalShare(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ownedProposal(req, res);
    if (!doc) return;
    const link = await ProposalLink.findOneAndUpdate({ documentId: doc._id }, { $set: { isActive: false } }, { new: true });
    res.json({ data: await shareInfo(doc._id, link) });
  } catch (error) {
    next(error);
  }
}

/** Resumo do link para a listagem de propostas salvas (selo "Visto há…"). */
export async function shareSummaries(documentIds: Types.ObjectId[]) {
  const links = await ProposalLink.find({ documentId: { $in: documentIds } })
    .select("documentId isActive viewsCount lastViewedAt")
    .lean();
  return new Map(
    links.map((link) => [
      String(link.documentId),
      { isActive: link.isActive, viewsCount: link.viewsCount || 0, lastViewedAt: link.lastViewedAt || null },
    ]),
  );
}

/** Remove link e visualizações junto com a proposta. */
export async function removeProposalShare(documentId: Types.ObjectId) {
  await Promise.all([ProposalLink.deleteMany({ documentId }), ProposalView.deleteMany({ documentId })]);
}

/* --------------------------------- Público --------------------------------- */

async function activeLink(token: unknown) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  return ProposalLink.findOne({ token, isActive: true }).select("_id documentId").lean();
}

/** GET /public/proposals/:token — só o necessário para renderizar a proposta. */
export async function getPublicProposal(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await activeLink(req.params.token);
    const doc = link ? await ToolDocument.findOne({ _id: link.documentId, tool: "proposal" }).select("title data").lean() : null;
    if (!doc) {
      res.status(404).json({ error: UNAVAILABLE });
      return;
    }
    res.json({ data: { title: doc.title, data: doc.data } });
  } catch (error) {
    next(error);
  }
}

/** POST /public/proposals/:token/views — abre uma sessão de visualização. */
export async function startProposalView(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await activeLink(req.params.token);
    if (!link) {
      res.status(404).json({ error: UNAVAILABLE });
      return;
    }
    const now = new Date();
    const recent = await ProposalView.countDocuments({ linkId: link._id, openedAt: { $gte: new Date(now.getTime() - 3600_000) } });
    if (recent >= MAX_VIEWS_PER_HOUR) {
      res.status(429).json({ error: "Muitas visualizações em pouco tempo." });
      return;
    }
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 400);
    const view = await ProposalView.create({
      documentId: link.documentId,
      linkId: link._id,
      key: crypto.randomBytes(16).toString("base64url"),
      openedAt: now,
      lastSeenAt: now,
      durationSeconds: 0,
      userAgent,
      ...summarizeUserAgent(userAgent),
    });
    await ProposalLink.updateOne(
      { _id: link._id },
      { $inc: { viewsCount: 1 }, $set: { lastViewedAt: now }, $min: { firstViewedAt: now } },
    );
    res.status(201).json({ data: { id: view._id, key: view.key } });
  } catch (error) {
    next(error);
  }
}

/** POST /public/proposals/:token/views/:viewId { key, seconds } — heartbeat (JSON ou sendBeacon). */
export async function heartbeatProposalView(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseBody(req.body);
    const key = typeof body.key === "string" ? body.key : "";
    if (!isValidObjectId(req.params.viewId) || !key || key.length > 64 || !TOKEN_PATTERN.test(String(req.params.token))) {
      res.status(400).json({ error: "Dados inválidos." });
      return;
    }
    const now = new Date();
    const view = await ProposalView.findOne({
      _id: req.params.viewId,
      key,
      openedAt: { $gte: new Date(now.getTime() - SESSION_WINDOW_MS) },
    })
      .select("openedAt")
      .lean();
    if (!view) {
      res.status(404).json({ error: "Sessão não encontrada." });
      return;
    }
    const seconds = clampDuration(body.seconds, view.openedAt, now);
    if (seconds === null) {
      res.status(400).json({ error: "Dados inválidos." });
      return;
    }
    // $max: heartbeats atrasados ou repetidos nunca diminuem o tempo já registrado.
    await ProposalView.updateOne({ _id: view._id }, { $max: { durationSeconds: seconds, lastSeenAt: now } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
