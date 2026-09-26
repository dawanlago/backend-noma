import { Types } from "mongoose";
import type { StageKind } from "../types";

/*
 * Conversão dos dados da primeira versão do sistema (deals, tarefas com Date,
 * anotações com userId, formulários sem dono) para o formato atual.
 * As funções daqui são puras; quem grava é migrateLegacyData (seedDefaults).
 */

type Doc = Record<string, unknown>;

export interface LegacyStage {
  _id: Types.ObjectId;
  name: string;
  kind?: StageKind;
  type?: string;
  color?: string;
  key?: string;
}

/** Etapa antiga: "closure" era o fechamento (venda feita); o resto fica em andamento. */
export function legacyStageKind(stage: LegacyStage): StageKind {
  if (stage.kind === "open" || stage.kind === "won" || stage.kind === "lost") return stage.kind;
  return stage.type === "closure" ? "won" : "open";
}

export function normalizeLegacyStages(stages: LegacyStage[]) {
  return stages.map((stage) => ({
    _id: stage._id,
    name: stage.name,
    kind: legacyStageKind(stage),
    color: stage.color || "",
    ...(stage.key ? { key: stage.key } : {}),
  }));
}

/** Data/hora antiga (Date) em data e horário de Brasília. */
export function splitLegacyDate(value: unknown): { dueDate: string; time: string } {
  const date = value instanceof Date ? value : typeof value === "string" && value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { dueDate: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { dueDate: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function legacyTaskPatch(task: Doc, leadIds: Set<string>) {
  const { dueDate, time } = typeof task.dueDate === "string" ? { dueDate: task.dueDate, time: String(task.time || "") } : splitLegacyDate(task.dueDate);
  const status = ["todo", "doing", "done"].includes(String(task.status)) ? String(task.status) : task.isCompleted ? "done" : "todo";
  const leadId = task.leadId || (task.dealId && leadIds.has(String(task.dealId)) ? task.dealId : undefined);
  return {
    $set: {
      ownerId: task.ownerId || task.userId,
      dueDate,
      time,
      status,
      done: status === "done",
      notes: String(task.notes ?? task.description ?? ""),
      ...(leadId ? { leadId } : {}),
    },
    $unset: { userId: "", isCompleted: "", description: "", dealId: "", googleEventId: "", googleSyncedAt: "" },
  };
}

interface DealContext {
  funnels: { _id: Types.ObjectId; stages: LegacyStage[] }[];
  products: Map<string, { name: string; price: number }>;
  userNames: Map<string, string>;
  contactNames: Map<string, string>;
  companyNames: Map<string, string>;
}

/** Negociação antiga (deal) no formato atual de lead, mantendo o mesmo _id. */
export function legacyDealToLead(deal: Doc, ctx: DealContext) {
  const funnel = ctx.funnels.find((item) => String(item._id) === String(deal.funnelId)) || ctx.funnels[0];
  const stages = funnel ? normalizeLegacyStages(funnel.stages) : [];
  const stage =
    stages.find((item) => String(item._id) === String(deal.currentStageId)) || stages.find((item) => item.kind === "open") || stages[0];
  const products = ((deal.productIds as unknown[]) || [])
    .map((id) => ({ id: String(id), product: ctx.products.get(String(id)) }))
    .filter((item) => item.product)
    .map((item) => ({ productId: new Types.ObjectId(item.id), name: item.product!.name, price: item.product!.price }));
  const productsTotal = products.reduce((total, item) => total + item.price, 0);
  const value = Math.max(0, Number(deal.value) || 0);
  const ownerId = deal.ownerUserId || deal.creatorUserId;
  const dossier = (deal.dossier || {}) as Doc;
  const comments = ((deal.notes as Doc[]) || [])
    .filter((note) => typeof note.text === "string" && note.text.trim())
    .map((note) => ({
      _id: note._id || new Types.ObjectId(),
      text: String(note.text).trim(),
      authorId: note.userId || ownerId,
      authorName: ctx.userNames.get(String(note.userId)) || "",
      createdAt: note.date || deal.createdAt,
    }));
  const status: StageKind = stage?.kind || "open";
  return {
    _id: deal._id,
    ownerId,
    name: String(deal.title || "").trim() || ctx.contactNames.get(String(deal.contactId)) || "Negociação",
    ...(deal.contactId ? { contactId: deal.contactId } : {}),
    ...(deal.companyId ? { companyId: deal.companyId } : {}),
    contactName: ctx.contactNames.get(String(deal.contactId)) || "",
    company: ctx.companyNames.get(String(deal.companyId)) || "",
    funnelId: funnel?._id,
    stageId: stage?._id,
    status,
    service: "",
    products,
    customValue: Math.max(0, value - productsTotal),
    value: Math.max(value, productsTotal),
    temperature: ["cold", "warm", "hot"].includes(String(deal.temperature)) ? deal.temperature : "warm",
    source: deal.source && deal.source !== "manual" ? String(deal.source) : "",
    notes: String(dossier.manualNotes || ""),
    custom: {},
    comments,
    history: [{ at: new Date(), text: "Negociação trazida da versão anterior do sistema", userName: "Sistema" }],
    ...(status === "won" ? { wonAt: deal.updatedAt || new Date() } : {}),
    createdAt: deal.createdAt || new Date(),
    updatedAt: deal.updatedAt || new Date(),
  };
}

const TARGET_BY_KEY: Record<string, string> = {
  nome: "name",
  name: "name",
  email: "email",
  "e-mail": "email",
  e_mail: "email",
  telefone: "phone",
  phone: "phone",
  whatsapp: "phone",
  empresa: "company",
  instagram: "instagram",
};

/** Campos de formulário antigos (com `order`, tipo "boolean") no formato atual. */
export function legacyFormFields(fields: unknown[]) {
  return (fields || [])
    .map((field, index) => (typeof field === "string" ? { key: field, label: field, type: "text", order: index } : (field as Doc)))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((field) => {
      const key = String(field.key || field.label || "campo");
      const type = field.type === "boolean" ? "checkbox" : String(field.type || "text");
      return {
        key,
        label: String(field.label || key),
        type,
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options.map(String) : [],
        placeholder: String(field.placeholder || ""),
        target: String(field.target ?? TARGET_BY_KEY[key.toLowerCase()] ?? ""),
      };
    });
}

/** Respostas antigas [{ key, value }] viram { key: value }. */
export function legacyAnswers(answers: unknown) {
  if (!Array.isArray(answers)) return (answers as Doc) || {};
  return Object.fromEntries(answers.map((answer) => [String((answer as Doc).key), (answer as Doc).value ?? ""]));
}
