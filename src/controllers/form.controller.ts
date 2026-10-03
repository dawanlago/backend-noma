import type { NextFunction, Request, Response } from "express";
import { notify } from "../lib/notifications";
import SchedulingLink from "../models/SchedulingLink";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Form, { type IForm } from "../models/Form";
import FormInvite from "../models/FormInvite";
import FormResponse, { MAX_RESPONSE_EVENTS, type IFormResponse } from "../models/FormResponse";
import Funnel from "../models/Funnel";
import Lead from "../models/Lead";
import {
  answeredCount,
  answersSummary,
  answerText,
  contactFromAnswers,
  DEFAULT_UNAVAILABLE_MESSAGE,
  eventInfo,
  newInviteCode,
  newPublicId,
  normalizeAvailability,
  normalizeFormFields,
  qualifiedStage,
  validateAnswers,
  type Answers,
  todayKey,
  type EventInfo,
} from "../lib/forms";
import { firstOpenStage } from "../lib/funnels";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";
import { phoneKey } from "../lib/phone";
import { isValidObjectId, type Types } from "mongoose";
import { getSettings } from "../lib/seedDefaults";

/** Identidade mostrada no topo do formulário público: a do próprio formulário ou a da produtora. */
async function publicBrand(form?: { logo?: string; accentColor?: string }) {
  const settings = await getSettings();
  return {
    logo: form?.logo || settings.brand?.logo || "",
    companyName: settings.companyName || "Noma",
    color: form?.accentColor || settings.brand?.defaultColor || "",
  };
}

function notFound(res: Response) {
  res.status(404).json({ error: "Formulário não encontrado." });
}

function applyBody(form: InstanceType<typeof Form>, body: Record<string, unknown>) {
  if (typeof body.name === "string" && body.name.trim()) form.name = body.name.trim();
  if (typeof body.description === "string") form.description = body.description;
  if (typeof body.successMessage === "string") form.successMessage = body.successMessage;
  if (typeof body.logo === "string") form.logo = body.logo.trim();
  if (typeof body.accentColor === "string") form.accentColor = /^#[0-9a-fA-F]{6}$/.test(body.accentColor.trim()) ? body.accentColor.trim() : "";
  if (typeof body.isActive === "boolean") form.isActive = body.isActive;
  if (typeof body.createLead === "boolean") form.createLead = body.createLead;
  if (body.fields !== undefined) form.set("fields", normalizeFormFields(body.fields));
  if (body.funnelId !== undefined) form.funnelId = (body.funnelId || undefined) as never;
  if (body.stageId !== undefined) form.stageId = (body.stageId || undefined) as never;
  if (body.availability !== undefined) form.set("availability", normalizeAvailability(body.availability));
  if (body.schedulingLinkId !== undefined) form.schedulingLinkId = (isValidObjectId(body.schedulingLinkId) ? body.schedulingLinkId : undefined) as never;
}

/** Link de agendamento (ativo) a oferecer no fim do formulário. */
async function schedulingSlugOf(form: { schedulingLinkId?: unknown }) {
  if (!form.schedulingLinkId) return "";
  const link = await SchedulingLink.findOne({ _id: form.schedulingLinkId, isActive: true }).select("slug").lean();
  return link?.slug || "";
}

export async function listForms(req: Request, res: Response, next: NextFunction) {
  try {
    const forms = await Form.find(ownerScope(req)).sort({ createdAt: -1 }).lean();
    const counts = await FormResponse.aggregate<{ _id: string; count: number; partial: number }>([
      { $match: { formId: { $in: forms.map((form) => form._id) } } },
      {
        $group: {
          _id: "$formId",
          count: { $sum: { $cond: [{ $eq: ["$status", "partial"] }, 0, 1] } },
          partial: { $sum: { $cond: [{ $eq: ["$status", "partial"] }, 1, 0] } },
        },
      },
    ]);
    const byForm = new Map(counts.map((row) => [String(row._id), row]));
    // Incompletas (quem parou no meio) contam à parte.
    const data = forms.map((form) => ({
      ...form,
      responsesCount: byForm.get(String(form._id))?.count || 0,
      partialCount: byForm.get(String(form._id))?.partial || 0,
    }));
    res.json({ data: await withOwnerNames(data) });
  } catch (error) {
    next(error);
  }
}

export async function getForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) }).lean();
    if (!form) return notFound(res);
    res.json({ data: form });
  } catch (error) {
    next(error);
  }
}

export async function createForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = new Form({ ownerId: req.user!._id, publicId: newPublicId(), name: "Novo formulário" });
    applyBody(form, req.body);
    if (!form.fields.length) {
      form.set(
        "fields",
        normalizeFormFields([
          { label: "Nome", type: "text", required: true, target: "name" },
          { label: "E-mail", type: "email", required: true, target: "email" },
          { label: "WhatsApp", type: "phone", target: "phone" },
          { label: "Empresa", type: "text", target: "company" },
          { label: "Como podemos ajudar?", type: "textarea" },
        ]),
      );
    }
    await form.save();
    res.status(201).json({ data: form.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!form) return notFound(res);
    applyBody(form, req.body);
    await form.save();
    res.json({ data: form.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
    if (!form) return notFound(res);
    await FormResponse.deleteMany({ formId: form._id });
    await FormInvite.deleteMany({ formId: form._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function listResponses(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) }).select("_id").lean();
    if (!form) return notFound(res);
    const data = await FormResponse.find({ formId: form._id }).sort({ createdAt: -1 }).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function deleteResponse(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ _id: req.params.id, ...recordScope(req) }).select("_id").lean();
    if (!form) return notFound(res);
    await FormResponse.deleteOne({ _id: req.params.responseId, formId: form._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* ------------------------------ Rotas públicas ----------------------------- */

/** Regra de disponibilidade enviada ao link público (o aviso já vem com o texto padrão). */
function publicAvailability(form: Pick<IForm, "availability">) {
  const rule = normalizeAvailability(form.availability);
  return { ...rule, message: rule.message || DEFAULT_UNAVAILABLE_MESSAGE };
}

export async function getPublicForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ publicId: req.params.publicId, isActive: true }).lean();
    if (!form) return notFound(res);
    res.json({
      data: {
        name: form.name,
        description: form.description,
        fields: form.fields,
        successMessage: form.successMessage,
        availability: publicAvailability(form),
        brand: await publicBrand(form),
        schedulingSlug: await schedulingSlugOf(form),
      },
    });
  } catch (error) {
    next(error);
  }
}

/* ------------------- Progresso salvo a cada pergunta (parcial) ------------------- */

/** Id da sessão gerado no navegador (guardado no localStorage por formulário). */
const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

function sessionIdFrom(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return SESSION_ID.test(id) ? id : "";
}

/** Limite simples por IP e link (por instância do servidor): o progresso é salvo a cada pergunta. */
const progressHits = new Map<string, { count: number; resetAt: number }>();
function tooManyProgressHits(req: Request) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
  const key = `${ip}|${req.params.publicId || req.params.code}`;
  const now = Date.now();
  const entry = progressHits.get(key);
  if (!entry || entry.resetAt < now) {
    if (progressHits.size > 5000) progressHits.clear();
    progressHits.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 90;
}

/** Passos que mudaram desde o último salvamento (histórico do preenchimento). */
function changedEvents(form: IForm, previous: Record<string, unknown>, answers: Answers) {
  const at = new Date();
  return form.fields
    .filter((field) => answerText(answers[field.key]) !== answerText(previous[field.key] as never))
    .map((field) => ({ at, fieldKey: field.key, value: answerText(answers[field.key]).slice(0, 500) }));
}

function eventFields(info: EventInfo | null) {
  return info
    ? { $set: { eventDate: info.eventDate, daysUntilEvent: info.daysUntilEvent, unavailable: info.unavailable } }
    : { $unset: { eventDate: 1, daysUntilEvent: 1, unavailable: 1 } };
}

/**
 * Grava o progresso de quem ainda está respondendo (não mexe em contatos nem negociações).
 * `key`: sessão do navegador (link público) ou o convite da negociação.
 */
async function saveProgress(
  form: IForm,
  key: { sessionId: string } | { inviteId: Types.ObjectId },
  answers: Answers,
  step: unknown,
  onInsert: Record<string, unknown> = {},
): Promise<"saved" | "complete"> {
  const existing = await FormResponse.findOne({ formId: form._id, ...key }).sort({ createdAt: -1 }).select("answers status").lean();
  if (existing?.status === "complete") return "complete";
  const lastStep = Math.min(Math.max(Math.floor(Number(step)) || 0, 0), Math.max(form.fields.length - 1, 0));
  const info = eventFields(eventInfo(form.fields, answers, form.availability));
  try {
    await FormResponse.findOneAndUpdate(
      { formId: form._id, ...key, status: "partial" },
      {
        $set: { answers, lastStep, stepsAnswered: answeredCount(form.fields, answers), ...("$set" in info ? info.$set : {}) },
        ...("$unset" in info ? { $unset: info.$unset } : {}),
        $setOnInsert: { ownerId: form.ownerId, ...onInsert },
        $push: { events: { $each: changedEvents(form, existing?.answers || {}, answers), $slice: -MAX_RESPONSE_EVENTS } },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // Envio final chegou ao mesmo tempo (índice único formId + sessionId).
    if ((error as { code?: number }).code === 11000) return "complete";
    throw error;
  }
  return "saved";
}

/** POST /public/forms/:publicId/progress { sessionId, answers, step } — salva a cada pergunta respondida. */
export async function savePublicProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ publicId: req.params.publicId, isActive: true });
    if (!form) return notFound(res);
    if (req.body?.website) {
      res.json({ data: { status: "saved" } });
      return;
    }
    const sessionId = sessionIdFrom(req.body?.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: "Sessão inválida." });
      return;
    }
    if (tooManyProgressHits(req)) {
      res.status(429).json({ error: "Muitas tentativas. Aguarde um instante." });
      return;
    }
    const { answers, error } = validateAnswers(form.fields, req.body?.answers, { partial: true });
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const status = await saveProgress(form, { sessionId }, answers, req.body?.step);
    if (status === "complete") {
      res.status(409).json({ error: "Este formulário já foi enviado." });
      return;
    }
    res.json({ data: { status } });
  } catch (error) {
    next(error);
  }
}

/** GET /public/forms/:publicId/progress/:sessionId — retoma o preenchimento depois de recarregar a página. */
export async function getPublicProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ publicId: req.params.publicId, isActive: true }).select("_id").lean();
    const sessionId = sessionIdFrom(req.params.sessionId);
    if (!form || !sessionId) return notFound(res);
    const response = await FormResponse.findOne({ formId: form._id, sessionId }).select("answers lastStep status").lean();
    res.json({ data: response ? { answers: response.answers, lastStep: response.lastStep || 0, status: response.status || "complete" } : null });
  } catch (error) {
    next(error);
  }
}

/* ----------------------------- Contato e negociação ----------------------------- */

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function eventSummary(info: EventInfo | null) {
  if (!info) return "";
  const days = info.daysUntilEvent === 1 ? "falta 1 dia" : `faltam ${info.daysUntilEvent} dias`;
  return `Data do evento: ${formatDateKey(info.eventDate)} (${days} no envio)${info.unavailable ? " — DATA INDISPONÍVEL" : ""}`;
}

async function companyByName(name: string) {
  if (!name) return null;
  return (
    (await Company.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) ||
    (await Company.create({ name, kinds: ["lead"] }))
  );
}

/**
 * Leva a resposta para o CRM. O contato é identificado pelo telefone (chave normalizada) e depois
 * pelo e-mail; se já existe, é atualizado (respostas vazias não apagam nada). Se ele já tem uma
 * negociação aberta no funil do formulário, ela vai para a etapa "qualificado" e recebe as respostas;
 * senão, abre uma negociação nova.
 */
async function applyToCrm(form: IForm, answers: Answers, info: EventInfo | null) {
  const data = contactFromAnswers(form.fields, answers);
  if (!data.name && !data.email && !data.phone) return {};
  const key = phoneKey(data.phone);
  let contact =
    (key ? await Contact.findOne({ phoneKey: key }).sort({ createdAt: 1 }) : null) ||
    (data.email ? await Contact.findOne({ email: data.email }).sort({ createdAt: 1 }) : null);
  const company = await companyByName(data.company);

  if (contact) {
    if (data.name) contact.name = data.name;
    if (data.email) contact.email = data.email;
    if (data.phone && phoneKey(contact.phone) !== key) contact.phone = data.phone;
    if (data.instagram) contact.instagram = data.instagram;
    if (company && !(contact.companyIds || []).some((id) => String(id) === String(company._id))) {
      contact.set("companyIds", [...(contact.companyIds || []), company._id]);
    }
    if (contact.isModified()) await contact.save();
  } else {
    contact = await Contact.create({
      name: data.name || data.email || data.phone,
      email: data.email,
      phone: data.phone,
      instagram: data.instagram,
      companyId: company?._id,
      kinds: ["lead"],
    });
  }

  const summary = [eventSummary(info), answersSummary(form.fields, answers)].filter(Boolean).join("\n");
  const unavailableNote = info?.unavailable ? [{ at: new Date(), text: `Data do evento indisponível (${formatDateKey(info.eventDate)})`, userName: "Formulário" }] : [];
  const eventData = info ? { eventDate: info.eventDate, eventUnavailable: info.unavailable } : {};

  const funnel = (form.funnelId && (await Funnel.findById(form.funnelId))) || (await Funnel.findOne().sort({ order: 1 }));
  const open = await Lead.findOne({ contactId: contact._id, status: "open", ...(form.funnelId && funnel ? { funnelId: funnel._id } : {}) }).sort({
    updatedAt: -1,
  });
  if (open) {
    const leadFunnel = funnel && String(funnel._id) === String(open.funnelId) ? funnel : await Funnel.findById(open.funnelId);
    const stage = leadFunnel ? qualifiedStage(leadFunnel.stages, leadFunnel.qualifiedStageId) : undefined;
    open.history.push({ at: new Date(), text: `Formulário respondido: ${form.name}`, userName: "Formulário" }, ...unavailableNote);
    if (stage && String(stage._id) !== String(open.stageId)) {
      open.stageId = stage._id;
      open.status = stage.kind;
      open.subStageId = undefined;
      open.history.push({ at: new Date(), text: `Movida para "${stage.name}" (formulário de contato existente)`, userName: "Formulário" });
    }
    open.notes = [open.notes, `Formulário respondido: ${form.name} (${formatDateKey(todayKey())})\n${summary}`]
      .filter(Boolean)
      .join("\n\n");
    open.set(eventData);
    if (!open.contactName) open.contactName = contact.name;
    await open.save();
    await notify([open.ownerId], {
      type: "form_response",
      title: `${contact.name} respondeu "${form.name}"`,
      body: stage ? `A negociação foi para "${stage.name}".` : "As respostas foram anexadas à negociação.",
      link: `/crm/${open._id}`,
    });
    return { contactId: contact._id, leadId: open._id };
  }

  const stage = funnel && (funnel.stages.find((item) => String(item._id) === String(form.stageId)) || firstOpenStage(funnel.stages));
  if (!funnel || !stage) return { contactId: contact._id };
  const lead = await Lead.create({
    ownerId: form.ownerId,
    name: contact.name,
    contactId: contact._id,
    contactName: contact.name,
    companyId: company?._id || contact.companyId,
    company: data.company,
    funnelId: funnel._id,
    stageId: stage._id,
    status: stage.kind,
    source: `Formulário: ${form.name}`,
    notes: summary,
    ...eventData,
    history: [{ at: new Date(), text: `Recebida pelo formulário "${form.name}"`, userName: "Formulário" }, ...unavailableNote],
  });
  await notify([lead.ownerId], {
    type: "lead_created",
    title: `Novo lead pelo formulário: ${contact.name}`,
    body: `"${form.name}" · etapa ${stage.name}${info?.unavailable ? " · data do evento indisponível" : ""}`,
    link: `/crm/${lead._id}`,
  });
  return { contactId: contact._id, leadId: lead._id };
}

/** Campos gravados quando o preenchimento é enviado de vez. */
function completeFields(form: IForm, answers: Answers, info: EventInfo | null) {
  return {
    answers,
    status: "complete" as const,
    completedAt: new Date(),
    lastStep: Math.max(form.fields.length - 1, 0),
    stepsAnswered: answeredCount(form.fields, answers),
    eventDate: info?.eventDate,
    daysUntilEvent: info?.daysUntilEvent,
    unavailable: info?.unavailable,
  };
}

/**
 * Envio final. Com `sessionId`, o registro parcial vira "complete" (uma vez só: envios repetidos
 * só recebem a mensagem de sucesso) e, se configurado, cria/atualiza o contato e a negociação.
 */
export async function submitPublicForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await Form.findOne({ publicId: req.params.publicId, isActive: true });
    if (!form) return notFound(res);
    const done = () => res.status(201).json({ data: { message: form.successMessage } });
    // Campo invisível: robôs costumam preenchê-lo.
    if (req.body?.website) return void done();
    const { answers, error } = validateAnswers(form.fields, req.body?.answers);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const info = eventInfo(form.fields, answers, form.availability);
    const fields = completeFields(form, answers, info);
    const sessionId = sessionIdFrom(req.body?.sessionId);

    let response: (IFormResponse & { save: () => Promise<unknown> }) | null = null;
    if (sessionId) {
      const previous = await FormResponse.findOne({ formId: form._id, sessionId }).select("answers status").lean();
      if (previous?.status === "complete") return void done();
      const events = changedEvents(form, previous?.answers || {}, answers);
      response = await FormResponse.findOneAndUpdate(
        { formId: form._id, sessionId, status: "partial" },
        { $set: fields, $push: { events: { $each: events, $slice: -MAX_RESPONSE_EVENTS } } },
        { returnDocument: "after" },
      );
      if (!response) {
        try {
          response = await FormResponse.create({ formId: form._id, ownerId: form.ownerId, sessionId, ...fields, events });
        } catch (createError) {
          // Outro envio da mesma sessão chegou antes: já foi registrado.
          if ((createError as { code?: number }).code === 11000) return void done();
          throw createError;
        }
      }
    } else {
      response = await FormResponse.create({ formId: form._id, ownerId: form.ownerId, ...fields });
    }

    if (form.createLead) {
      const linked = await applyToCrm(form, answers, info);
      if (linked.contactId) {
        response.contactId = linked.contactId;
        response.leadId = linked.leadId;
        await response.save();
      }
    }
    done();
  } catch (error) {
    next(error);
  }
}

/* -------------------- Formulário enviado pela negociação -------------------- */

async function uniqueInviteCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = newInviteCode();
    if (!(await FormInvite.exists({ code }))) return code;
  }
  throw new Error("Não foi possível gerar o código do formulário.");
}

/** GET /leads/:id/form-invites — formulários enviados nesta negociação, com as respostas. */
export async function listLeadInvites(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) }).select("_id").lean();
    if (!lead) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }
    const invites = await FormInvite.find({ leadId: lead._id }).sort({ createdAt: -1 }).lean();
    const [forms, responses] = await Promise.all([
      Form.find({ _id: { $in: invites.map((invite) => invite.formId) } }).select("name fields").lean(),
      FormResponse.find({ _id: { $in: invites.flatMap((invite) => (invite.responseId ? [invite.responseId] : [])) } }).lean(),
    ]);
    res.json({
      data: invites.map((invite) => {
        const form = forms.find((item) => String(item._id) === String(invite.formId));
        const response = responses.find((item) => String(item._id) === String(invite.responseId));
        return {
          ...invite,
          formName: form?.name || "Formulário",
          answers: response
            ? (form?.fields || []).map((field) => ({ label: field.label, value: answerText(response.answers[field.key] as never) }))
            : [],
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}

/** POST /leads/:id/form-invites { formId } — gera o código (ou reaproveita o pendente). */
export async function createLeadInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!lead) {
      res.status(404).json({ error: "Negociação não encontrada." });
      return;
    }
    const form = await Form.findOne({ _id: req.body.formId, isActive: true }).lean();
    if (!form) {
      res.status(404).json({ error: "Formulário não encontrado ou pausado." });
      return;
    }
    let invite = await FormInvite.findOne({ leadId: lead._id, formId: form._id });
    if (invite?.status === "submitted") {
      res.status(400).json({ error: "Este formulário já foi preenchido nesta negociação." });
      return;
    }
    if (invite) {
      invite.sentAt = new Date();
      await invite.save();
    } else {
      invite = await FormInvite.create({
        code: await uniqueInviteCode(),
        formId: form._id,
        leadId: lead._id,
        contactId: lead.contactId,
        ownerId: req.user!._id,
      });
      lead.history.push({ at: new Date(), text: `Formulário "${form.name}" enviado (código ${invite.code})`, userName: req.user!.name });
      await lead.save();
    }
    res.status(201).json({ data: { ...invite.toJSON(), formName: form.name, answers: [] } });
  } catch (error) {
    next(error);
  }
}

/** Valores já conhecidos do contato para preencher o formulário. */
function prefillFor(form: IForm, contact: { name?: string; email?: string; phone?: string; instagram?: string } | null, company: string) {
  const values: Record<string, string> = {};
  if (!contact) return values;
  for (const field of form.fields) {
    const value =
      field.target === "name" ? contact.name
      : field.target === "email" ? contact.email
      : field.target === "phone" ? contact.phone
      : field.target === "instagram" ? contact.instagram
      : field.target === "company" ? company
      : "";
    if (value) values[field.key] = value;
  }
  return values;
}

export async function getInviteByCode(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code }).lean();
    const form = invite ? await Form.findOne({ _id: invite.formId, isActive: true }) : null;
    if (!invite || !form) return notFound(res);
    const [contact, lead, response, partial] = await Promise.all([
      invite.contactId ? Contact.findById(invite.contactId).lean() : null,
      Lead.findById(invite.leadId).select("company").lean(),
      invite.responseId ? FormResponse.findById(invite.responseId).lean() : null,
      invite.status === "pending" ? FormResponse.findOne({ inviteId: invite._id, status: "partial" }).select("answers lastStep").lean() : null,
    ]);
    res.json({
      data: {
        name: form.name,
        description: form.description,
        fields: form.fields,
        successMessage: form.successMessage,
        status: invite.status,
        brand: await publicBrand(form),
        contactFirstName: (contact?.name || "").split(" ")[0] || "",
        // O que a pessoa já tinha respondido (progresso salvo) vale mais que o cadastro.
        prefill: {
          ...prefillFor(form, contact, lead?.company || ""),
          ...Object.fromEntries(Object.entries((partial?.answers as Answers) || {}).filter(([, value]) => answerText(value) !== "" && value !== false)),
        },
        lastStep: partial?.lastStep || 0,
        availability: publicAvailability(form),
        answers: response
          ? form.fields.map((field) => ({ label: field.label, value: answerText(response.answers[field.key] as never) }))
          : [],
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function submitInviteByCode(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code });
    const form = invite ? await Form.findOne({ _id: invite.formId, isActive: true }) : null;
    if (!invite || !form) return notFound(res);
    if (invite.status === "submitted") {
      res.status(409).json({ error: "Este formulário já foi preenchido." });
      return;
    }
    const { answers, error } = validateAnswers(form.fields, req.body?.answers);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    // Marca o convite antes de tudo: dois envios ao mesmo tempo não registram duas vezes.
    const claimed = await FormInvite.updateOne({ _id: invite._id, status: "pending" }, { $set: { status: "submitted", submittedAt: new Date() } });
    if (!claimed.modifiedCount) {
      res.status(409).json({ error: "Este formulário já foi preenchido." });
      return;
    }
    const info = eventInfo(form.fields, answers, form.availability);
    const fields = { ...completeFields(form, answers, info), contactId: invite.contactId, leadId: invite.leadId };
    let response;
    try {
      const partial = await FormResponse.findOne({ inviteId: invite._id, status: "partial" }).select("answers").lean();
      const events = changedEvents(form, partial?.answers || {}, answers);
      response =
        (partial &&
          (await FormResponse.findOneAndUpdate(
            { _id: partial._id },
            { $set: fields, $push: { events: { $each: events, $slice: -MAX_RESPONSE_EVENTS } } },
            { returnDocument: "after" },
          ))) ||
        (await FormResponse.create({ formId: form._id, ownerId: form.ownerId, inviteId: invite._id, ...fields, events }));
    } catch (saveError) {
      // Não conseguiu gravar: o convite volta a aceitar o envio.
      await FormInvite.updateOne({ _id: invite._id }, { $set: { status: "pending" }, $unset: { submittedAt: 1 } });
      throw saveError;
    }
    await FormInvite.updateOne({ _id: invite._id }, { $set: { responseId: response._id } });

    // Atualiza o contato com o que ele informou nos campos ligados ao cadastro.
    const data = contactFromAnswers(form.fields, answers);
    if (invite.contactId) {
      const update: Record<string, string> = {};
      for (const key of ["name", "email", "phone", "instagram"] as const) if (data[key]) update[key] = data[key];
      if (update.phone) update.phoneKey = phoneKey(update.phone);
      if (Object.keys(update).length) await Contact.updateOne({ _id: invite.contactId }, { $set: update });
    }
    const history = [{ at: new Date(), text: `Formulário "${form.name}" preenchido pelo cliente`, userName: "Cliente" }];
    if (info?.unavailable) history.push({ at: new Date(), text: `Data do evento indisponível (${formatDateKey(info.eventDate)})`, userName: "Formulário" });
    await Lead.updateOne(
      { _id: invite.leadId },
      {
        $push: { history: { $each: history } },
        ...(info ? { $set: { eventDate: info.eventDate, eventUnavailable: info.unavailable } } : {}),
      },
    );
    const invitedLead = await Lead.findById(invite.leadId).select("ownerId name").lean();
    if (invitedLead) {
      await notify([invitedLead.ownerId], {
        type: "form_response",
        title: `Formulário respondido: ${form.name}`,
        body: `O cliente de "${invitedLead.name}" preencheu o formulário.`,
        link: `/crm/${invitedLead._id}`,
      });
    }
    res.status(201).json({ data: { message: form.successMessage } });
  } catch (error) {
    next(error);
  }
}

/** POST /public/form-invites/:code/progress { answers, step } — progresso do formulário enviado pela negociação. */
export async function saveInviteProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const invite = await FormInvite.findOne({ code: req.params.code }).lean();
    const form = invite ? await Form.findOne({ _id: invite.formId, isActive: true }) : null;
    if (!invite || !form) return notFound(res);
    if (invite.status === "submitted") {
      res.status(409).json({ error: "Este formulário já foi preenchido." });
      return;
    }
    if (tooManyProgressHits(req)) {
      res.status(429).json({ error: "Muitas tentativas. Aguarde um instante." });
      return;
    }
    const { answers, error } = validateAnswers(form.fields, req.body?.answers, { partial: true });
    if (error) {
      res.status(400).json({ error });
      return;
    }
    await saveProgress(form, { inviteId: invite._id }, answers, req.body?.step, { leadId: invite.leadId, contactId: invite.contactId });
    res.json({ data: { status: "saved" } });
  } catch (error) {
    next(error);
  }
}
