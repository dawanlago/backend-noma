import crypto from "crypto";
import { notify } from "../lib/notifications";
import express, { type NextFunction, type Request, type Response } from "express";
import { isValidObjectId, type Types } from "mongoose";
import Lead from "../models/Lead";
import ProposalEvent, { type ProposalEventType } from "../models/ProposalEvent";
import ProposalLink, { type IProposalLink } from "../models/ProposalLink";
import ProposalView from "../models/ProposalView";
import ToolDocument from "../models/ToolDocument";
import { recordScope, useModuleScope } from "../lib/ownership";
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
  useModuleScope(req, TOOL_MODULES.proposal);
  const doc = isValidObjectId(req.params.id)
    ? await ToolDocument.findOne({ _id: req.params.id, tool: "proposal", ...recordScope(req) }).select("_id ownerId").lean()
    : null;
  if (!doc) {
    res.status(404).json({ error: "Proposta não encontrada." });
    return null;
  }
  return doc;
}

/** Registra um item do histórico do link (ações da equipe, visualizações e aceite). */
async function logEvent(
  documentId: Types.ObjectId,
  linkId: Types.ObjectId | undefined,
  type: ProposalEventType,
  extra: { actorName?: string; comment?: string; userAgent?: string } = {},
) {
  const device = extra.userAgent !== undefined ? summarizeUserAgent(extra.userAgent) : {};
  await ProposalEvent.create({
    documentId,
    linkId,
    type,
    at: new Date(),
    actorName: extra.actorName || "",
    comment: extra.comment || "",
    ...device,
  });
}

/** Link, totais, aceite, sessões de visualização e histórico de uma proposta. */
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
  const events = await ProposalEvent.find({ documentId })
    .select("type at actorName comment device os browser")
    .sort({ at: -1 })
    .limit(200)
    .lean();
  return {
    link: link ? { token: link.token, isActive: link.isActive, createdAt: link.createdAt } : null,
    accepted: link?.acceptedAt
      ? { at: link.acceptedAt, name: link.acceptedName || "", comment: link.acceptedComment || "" }
      : null,
    events,
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
    const actorName = req.user!.name;
    if (!link) {
      link = await ProposalLink.create({ token: newToken(), documentId: doc._id, ownerId: doc.ownerId });
      await logEvent(doc._id, link._id, "link_created", { actorName });
    } else {
      // Gerar um novo link invalida o anterior e libera um novo aceite; o histórico continua.
      const regenerate = req.body?.regenerate === true;
      const wasActive = link.isActive;
      if (regenerate) {
        link.token = newToken();
        link.acceptedAt = undefined;
        link.acceptedName = undefined;
        link.acceptedComment = undefined;
      }
      link.isActive = true;
      await link.save();
      if (regenerate) await logEvent(doc._id, link._id, "link_regenerated", { actorName });
      else if (!wasActive) await logEvent(doc._id, link._id, "link_enabled", { actorName });
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
    const before = await ProposalLink.findOneAndUpdate({ documentId: doc._id }, { $set: { isActive: false } });
    if (before?.isActive) await logEvent(doc._id, before._id, "link_disabled", { actorName: req.user!.name });
    const link = before ? await ProposalLink.findById(before._id) : null;
    res.json({ data: await shareInfo(doc._id, link) });
  } catch (error) {
    next(error);
  }
}

/** Resumo do link para a listagem de propostas salvas (selo "Visto há…"). */
export async function shareSummaries(documentIds: Types.ObjectId[]) {
  const links = await ProposalLink.find({ documentId: { $in: documentIds } })
    .select("documentId isActive viewsCount lastViewedAt acceptedAt")
    .lean();
  return new Map(
    links.map((link) => [
      String(link.documentId),
      {
        isActive: link.isActive,
        viewsCount: link.viewsCount || 0,
        lastViewedAt: link.lastViewedAt || null,
        acceptedAt: link.acceptedAt || null,
      },
    ]),
  );
}

/** Remove link, visualizações e histórico junto com a proposta. */
export async function removeProposalShare(documentId: Types.ObjectId) {
  await Promise.all([
    ProposalLink.deleteMany({ documentId }),
    ProposalView.deleteMany({ documentId }),
    ProposalEvent.deleteMany({ documentId }),
  ]);
}

/* --------------------------------- Público --------------------------------- */

async function activeLink(token: unknown) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  return ProposalLink.findOne({ token, isActive: true }).select("_id documentId acceptedAt acceptedName").lean();
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
    const accepted = link?.acceptedAt ? { at: link.acceptedAt, name: link.acceptedName || "" } : null;
    res.json({ data: { title: doc.title, data: doc.data, accepted } });
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
    await logEvent(link.documentId, link._id, "viewed", { userAgent });
    // Avisa o dono na primeira abertura e quando o cliente volta depois de um tempo (sem repetir a cada recarga).
    if (!link.lastViewedAt || now.getTime() - new Date(link.lastViewedAt).getTime() > 6 * 3600_000) {
      const doc = await ToolDocument.findOne({ _id: link.documentId }).select("ownerId title data.leadId").lean();
      if (doc) {
        await notify([doc.ownerId], {
          type: "proposal_viewed",
          title: link.lastViewedAt ? `Proposta aberta de novo: ${doc.title}` : `O cliente abriu a proposta: ${doc.title}`,
          body: `${({ mobile: "Celular", tablet: "Tablet", desktop: "Computador" } as Record<string, string>)[view.device] || "Dispositivo"}${view.browser ? ` · ${view.browser}` : ""}`,
          link: "/propostas",
        });
      }
    }
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

/** POST /public/proposals/:token/accept { name, comment? } — aceite do cliente (uma vez por link). */
export async function acceptPublicProposal(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseBody(req.body);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
    const link = await activeLink(req.params.token);
    if (!link) {
      res.status(404).json({ error: UNAVAILABLE });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "Informe seu nome para aceitar a proposta." });
      return;
    }
    const now = new Date();
    // Condição no próprio update: dois cliques simultâneos não geram dois aceites.
    const accepted = await ProposalLink.findOneAndUpdate(
      { _id: link._id, isActive: true, acceptedAt: null },
      { $set: { acceptedAt: now, acceptedName: name, acceptedComment: comment } },
      { returnDocument: "after" },
    );
    if (!accepted) {
      res.status(409).json({ error: "Esta proposta já foi aceita." });
      return;
    }
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 400);
    await logEvent(link.documentId, link._id, "accepted", { actorName: name, comment, userAgent });

    // Proposta criada a partir de uma negociação: registra o aceite no histórico dela.
    const doc = await ToolDocument.findOne({ _id: link.documentId }).select("data.leadId").lean();
    const leadId = (doc?.data as { leadId?: unknown } | undefined)?.leadId;
    if (typeof leadId === "string" && isValidObjectId(leadId)) {
      const text = comment ? `Proposta aceita pelo cliente: "${comment.slice(0, 300)}"` : "Proposta aceita pelo cliente";
      await Lead.updateOne({ _id: leadId }, { $push: { history: { at: now, text, userName: name } } });
    }
    const owner = await ToolDocument.findOne({ _id: link.documentId }).select("ownerId title").lean();
    if (owner) {
      await notify([owner.ownerId], {
        type: "proposal_accepted",
        title: `Proposta aceita: ${owner.title}`,
        body: `${name}${comment ? `: "${comment.slice(0, 200)}"` : ""}`,
        link: typeof leadId === "string" && isValidObjectId(leadId) ? `/crm/${leadId}` : "/propostas",
        email: true,
      });
    }
    res.status(201).json({ data: { at: now, name } });
  } catch (error) {
    next(error);
  }
}
