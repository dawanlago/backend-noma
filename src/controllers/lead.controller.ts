import type { NextFunction, Request, Response } from "express";
import { notify } from "../lib/notifications";
import { isValidObjectId, Types } from "mongoose";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Funnel, { type IFunnel } from "../models/Funnel";
import Lead, { type ILead } from "../models/Lead";
import OptionItem from "../models/OptionItem";
import Task from "../models/Task";
import User from "../models/User";
import { firstOpenStage, firstStageOfKind } from "../lib/funnels";
import { ownerScope, recordScope } from "../lib/ownership";
import type { LeadStatus } from "../types";

const TEMPERATURES = ["cold", "warm", "hot"];

function objectIdOrNull(value: unknown) {
  return typeof value === "string" && isValidObjectId(value) ? new Types.ObjectId(value) : null;
}

function notFound(res: Response) {
  res.status(404).json({ error: "Negociação não encontrada." });
}

async function findFunnel(id: unknown) {
  const funnelId = objectIdOrNull(id);
  if (funnelId) {
    const funnel = await Funnel.findById(funnelId);
    if (funnel) return funnel;
  }
  return Funnel.findOne().sort({ order: 1, createdAt: 1 });
}

function stageOf(funnel: IFunnel, stageId: unknown) {
  return funnel.stages.find((stage) => String(stage._id) === String(stageId));
}

/** Copia os campos editáveis do corpo da requisição para a negociação. */
function applyBody(lead: ILead, body: Record<string, unknown>) {
  if (typeof body.name === "string") lead.name = body.name.trim();
  for (const key of ["service", "source", "notes"] as const) {
    if (typeof body[key] === "string") lead[key] = body[key] as string;
  }
  if (typeof body.temperature === "string" && TEMPERATURES.includes(body.temperature)) {
    lead.temperature = body.temperature as ILead["temperature"];
  }
  if (body.customValue !== undefined) lead.customValue = Math.max(0, Number(body.customValue) || 0);
  for (const key of ["offeredValue", "closedValue"] as const) {
    if (body[key] === undefined) continue;
    lead[key] = body[key] === null || body[key] === "" ? undefined : Math.round(Math.max(0, Number(body[key]) || 0) * 100) / 100;
  }
  if (Array.isArray(body.products)) {
    lead.products = body.products
      .map((item) => item as Record<string, unknown>)
      .filter((item) => typeof item.name === "string" && item.name.trim())
      .map((item) => ({
        productId: objectIdOrNull(item.productId) || undefined,
        name: String(item.name).trim(),
        description: typeof item.description === "string" ? item.description.trim() : "",
        price: Math.max(0, Number(item.price) || 0),
      }));
  }
  if (body.nextActionDate !== undefined) {
    lead.nextActionDate = body.nextActionDate ? new Date(String(body.nextActionDate)) : undefined;
  }
  if (body.custom && typeof body.custom === "object") {
    lead.custom = body.custom as Record<string, unknown>;
    lead.markModified("custom");
  }
  if (body.contactId !== undefined) lead.contactId = objectIdOrNull(body.contactId) || undefined;
  if (body.companyId !== undefined) lead.companyId = objectIdOrNull(body.companyId) || undefined;
}

/** Atualiza os nomes copiados do contato/empresa e herda a empresa do contato. */
async function syncRelations(lead: ILead) {
  const contact = lead.contactId ? await Contact.findById(lead.contactId).select("name companyId").lean() : null;
  if (!contact) lead.contactId = undefined;
  if (contact && !lead.companyId && contact.companyId) lead.companyId = contact.companyId;
  const company = lead.companyId ? await Company.findById(lead.companyId).select("name").lean() : null;
  if (!company) lead.companyId = undefined;
  lead.contactName = contact?.name || "";
  if (company) lead.company = company.name;
  else if (lead.isModified("companyId")) lead.company = "";
  if (!lead.name) lead.name = contact?.name || company?.name || "";
}

function moveTo(lead: ILead, funnel: IFunnel, stageId: Types.ObjectId, userName: string) {
  const stage = stageOf(funnel, stageId);
  if (!stage) return;
  const changed = String(lead.stageId) !== String(stage._id) || String(lead.funnelId) !== String(funnel._id);
  lead.funnelId = funnel._id;
  lead.stageId = stage._id;
  lead.status = stage.kind;
  if (changed) {
    // Ao trocar de etapa, entra na primeira microetapa dela (se houver).
    lead.subStageId = stage.subStages?.[0]?._id;
    lead.history.push({ at: new Date(), text: `Movida para "${stage.name}" (${funnel.name})`, userName });
  }
}

/** Troca a microetapa dentro da etapa atual ("" = nenhuma). */
function moveToSubStage(lead: ILead, funnel: IFunnel, subStageId: unknown, userName: string) {
  const stage = stageOf(funnel, lead.stageId);
  if (!stage) return;
  const sub = stage.subStages?.find((item) => String(item._id) === String(subStageId));
  if (String(lead.subStageId || "") === String(sub?._id || "")) return;
  lead.subStageId = sub?._id;
  lead.history.push({ at: new Date(), text: sub ? `Microetapa "${sub.name}" (${stage.name})` : `Saiu da microetapa (${stage.name})`, userName });
}

const LOST_REASON_REQUIRED = "Informe o motivo da perda para marcar a negociação como perdida.";

/**
 * Grava o motivo (e a observação) da perda e registra no histórico.
 * Devolve `false` quando o motivo não veio — perder uma negociação sempre exige motivo.
 */
async function applyLoss(lead: ILead, body: Record<string, unknown>, userName: string) {
  const reason = typeof body.lostReason === "string" ? body.lostReason.trim() : "";
  if (!reason) return false;
  const note = typeof body.lostNote === "string" ? body.lostNote.trim() : "";
  const option = await OptionItem.findOne({ list: "lostReason", value: reason }).select("label").lean();
  lead.lostReason = reason;
  lead.lostNote = note || undefined;
  lead.history.push({
    at: new Date(),
    text: `Negociação perdida — motivo: ${option?.label || reason}${note ? ` (${note})` : ""}`,
    userName,
  });
  return true;
}

function lossRequired(res: Response) {
  res.status(400).json({ error: LOST_REASON_REQUIRED, code: "LOST_REASON_REQUIRED" });
}

/**
 * Troca o responsável (`ownerId`): só quem vê todas as negociações, e só para usuários da empresa.
 * Devolve a mensagem de erro (com o status) ou null.
 */
async function changeOwner(req: Request, lead: ILead): Promise<{ status: number; error: string } | null> {
  const ownerId = objectIdOrNull(req.body.ownerId);
  if (req.body.ownerId === undefined || String(req.body.ownerId) === String(lead.ownerId)) return null;
  if (req.scopeLevel !== "all") return { status: 403, error: "Só quem vê todas as negociações pode trocar o responsável." };
  const orgId = req.access?.org._id;
  const user = ownerId
    ? await User.findOne({ _id: ownerId, isActive: { $ne: false }, $or: [{ "memberships.orgId": orgId }, { isSuperAdmin: true }] }).select("name").lean()
    : null;
  if (!user) return { status: 400, error: "Usuário não encontrado nesta empresa." };
  lead.ownerId = user._id;
  lead.history.push({ at: new Date(), text: `Responsável alterado para ${user.name}`, userName: req.user!.name });
  if (String(user._id) !== String(req.user!._id)) {
    await notify([user._id], { type: "lead_assigned", title: `Você é o responsável por "${lead.name}"`, body: `Passada por ${req.user!.name}.`, link: `/crm/${lead._id}` });
  }
  return null;
}

/** Anexa os nomes do responsável (`ownerName`) e de quem criou (`createdByName`). */
async function withPeople<T extends { ownerId?: unknown; createdBy?: unknown }>(docs: T[]) {
  const ids = [...new Set(docs.flatMap((doc) => [String(doc.ownerId), String(doc.createdBy)]).filter((id) => isValidObjectId(id)))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const names = new Map(users.map((user) => [String(user._id), user.name]));
  return docs.map((doc) => ({ ...doc, ownerName: names.get(String(doc.ownerId)) || "", createdByName: names.get(String(doc.createdBy)) || "" }));
}

async function respond(res: Response, lead: ILead, status = 200) {
  const [withNames] = await withPeople([lead.toJSON() as { ownerId?: unknown; createdBy?: unknown }]);
  res.status(status).json({ data: withNames });
}

export async function listLeads(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = { ...ownerScope(req) };
    for (const key of ["funnelId", "contactId", "companyId"]) {
      const id = objectIdOrNull(req.query[key]);
      if (id) filter[key] = id;
    }
    if (typeof req.query.status === "string" && ["open", "won", "lost"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const docs = await Lead.find(filter).select("-history").sort({ updatedAt: -1 }).lean();
    const data = docs.map(({ comments, ...doc }) => ({ ...doc, commentsCount: comments?.length || 0 }));
    res.json({ data: await withPeople(data) });
  } catch (error) {
    next(error);
  }
}

export async function getLead(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!lead) return notFound(res);
    await respond(res, lead);
  } catch (error) {
    next(error);
  }
}

export async function createLead(req: Request, res: Response, next: NextFunction) {
  try {
    const funnel = await findFunnel(req.body.funnelId);
    if (!funnel || !funnel.stages.length) {
      res.status(400).json({ error: "Cadastre um funil com etapas antes de criar negociações." });
      return;
    }
    const lead = new Lead({ ownerId: req.user!._id, createdBy: req.user!._id, funnelId: funnel._id });
    applyBody(lead, req.body);
    await syncRelations(lead);
    if (!lead.name) {
      res.status(400).json({ error: "Informe o contato ou o nome da negociação." });
      return;
    }
    const stage = stageOf(funnel, req.body.stageId) || firstOpenStage(funnel.stages)!;
    lead.stageId = stage._id;
    lead.status = stage.kind;
    lead.subStageId = stage.subStages?.find((sub: { _id: Types.ObjectId }) => String(sub._id) === String(req.body.subStageId))?._id || stage.subStages?.[0]?._id;
    lead.history.push({ at: new Date(), text: `Negociação criada em "${stage.name}" (${funnel.name})`, userName: req.user!.name });
    if (stage.kind === "lost" && !(await applyLoss(lead, req.body, req.user!.name))) return lossRequired(res);
    await lead.save();
    await respond(res, lead, 201);
  } catch (error) {
    next(error);
  }
}

export async function updateLead(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!lead) return notFound(res);
    const wasLost = lead.status === "lost";
    applyBody(lead, req.body);
    if (lead.isModified("contactId") || lead.isModified("companyId") || !lead.name) await syncRelations(lead);
    const ownerError = await changeOwner(req, lead);
    if (ownerError) {
      res.status(ownerError.status).json({ error: ownerError.error });
      return;
    }

    const funnelChanged = req.body.funnelId && String(req.body.funnelId) !== String(lead.funnelId);
    if (funnelChanged || req.body.stageId) {
      const funnel = funnelChanged ? await Funnel.findById(req.body.funnelId) : await Funnel.findById(lead.funnelId);
      if (!funnel) {
        res.status(400).json({ error: "Funil não encontrado." });
        return;
      }
      const stage = stageOf(funnel, req.body.stageId) || firstOpenStage(funnel.stages);
      if (stage) moveTo(lead, funnel, stage._id, req.user!.name);
      if (req.body.subStageId !== undefined) moveToSubStage(lead, funnel, req.body.subStageId, req.user!.name);
    } else if (req.body.subStageId !== undefined) {
      const funnel = await Funnel.findById(lead.funnelId);
      if (funnel) moveToSubStage(lead, funnel, req.body.subStageId, req.user!.name);
    }
    // Entrou numa etapa de perda (arrastando no funil, pela extensão...): exige o motivo.
    // Já perdida: o motivo pode ser corrigido enviando `lostReason` de novo.
    if (lead.status === "lost" && (!wasLost || typeof req.body.lostReason === "string")) {
      if (!(await applyLoss(lead, req.body, req.user!.name)) && !wasLost) return lossRequired(res);
    }
    await lead.save();
    await respond(res, lead);
  } catch (error) {
    next(error);
  }
}

export async function deleteLead(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
    if (!lead) return notFound(res);
    await Task.updateMany({ leadId: lead._id }, { $unset: { leadId: 1 } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

const STATUS_TEXT: Record<LeadStatus, string> = {
  won: "Venda feita",
  lost: "Negociação perdida",
  open: "Negociação reaberta",
};

/** POST /leads/:id/status { status } — "Venda feita", "Perdida" ou reabrir. */
export async function setLeadStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.body.status as LeadStatus;
    if (!["open", "won", "lost"].includes(status)) {
      res.status(400).json({ error: "Status inválido." });
      return;
    }
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!lead) return notFound(res);
    if (status === "lost" && !(typeof req.body.lostReason === "string" && req.body.lostReason.trim())) return lossRequired(res);
    const funnel = await Funnel.findById(lead.funnelId);
    const stage = funnel ? (status === "open" ? firstOpenStage(funnel.stages) : firstStageOfKind(funnel.stages, status)) : undefined;
    if (stage && funnel) {
      if (String(lead.stageId) !== String(stage._id)) lead.subStageId = stage.subStages?.[0]?._id;
      lead.stageId = stage._id;
      // A perda entra no histórico com o motivo (applyLoss).
      if (status !== "lost") lead.history.push({ at: new Date(), text: `${STATUS_TEXT[status]} — etapa "${stage.name}"`, userName: req.user!.name });
    } else if (status !== "lost") {
      lead.history.push({ at: new Date(), text: STATUS_TEXT[status], userName: req.user!.name });
    }
    lead.status = status;
    if (status === "lost") await applyLoss(lead, req.body, req.user!.name);
    await lead.save();
    await respond(res, lead);
  } catch (error) {
    next(error);
  }
}

export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const text = String(req.body.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "Escreva o parecer." });
      return;
    }
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!lead) return notFound(res);
    lead.comments.push({ text, authorId: req.user!._id, authorName: req.user!.name, createdAt: new Date() });
    lead.lastContactAt = new Date();
    await lead.save();
    await respond(res, lead, 201);
  } catch (error) {
    next(error);
  }
}

/** Alterar ou apagar parecer: somente administradores. */
export async function updateComment(req: Request, res: Response, next: NextFunction) {
  try {
    const text = String(req.body.text || "").trim();
    const lead = await Lead.findById(req.params.id);
    const comment = lead?.comments.id(req.params.commentId);
    if (!lead || !comment) {
      res.status(404).json({ error: "Parecer não encontrado." });
      return;
    }
    if (!text) {
      res.status(400).json({ error: "Escreva o parecer." });
      return;
    }
    comment.text = text;
    comment.editedAt = new Date();
    await lead.save();
    await respond(res, lead);
  } catch (error) {
    next(error);
  }
}

export async function deleteComment(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findById(req.params.id);
    const comment = lead?.comments.id(req.params.commentId);
    if (!lead || !comment) {
      res.status(404).json({ error: "Parecer não encontrado." });
      return;
    }
    comment.deleteOne();
    await lead.save();
    await respond(res, lead);
  } catch (error) {
    next(error);
  }
}
