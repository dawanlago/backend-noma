import type { Types } from "mongoose";
import Contact, { type IContact } from "../models/Contact";
import Funnel from "../models/Funnel";
import Lead, { type ILead } from "../models/Lead";
import { firstOpenStage } from "./funnels";
import { qualifiedStage } from "./forms";
import { notify, orgAdmins } from "./notifications";
import { phoneKey } from "./phone";

/**
 * Entrada de leads vindos de fora (WhatsApp, API de automação). Junta pelo telefone (chave normalizada)
 * e depois pelo e-mail, para o mesmo cliente nunca virar dois contatos nem dois cartões no funil:
 * - contato existente é atualizado (campos vazios não apagam nada);
 * - se ele já tem negociação aberta, ela é reaproveitada (e pode avançar para "qualificado");
 * - senão, abre uma negociação na primeira etapa do funil.
 */
export interface IntakeInput {
  name?: string;
  phone?: string;
  email?: string;
  instagram?: string;
  /** Origem gravada na negociação nova (ex.: "WhatsApp", "API"). */
  source: string;
  /** Quem aparece no histórico (ex.: "WhatsApp", "Automação"). */
  actor: string;
  funnelId?: string | Types.ObjectId;
  stageId?: string | Types.ObjectId;
  /** Leva a negociação (nova ou existente) para a etapa "qualificado" do funil. */
  qualify?: boolean;
  ownerId?: string | Types.ObjectId;
  notes?: string;
  custom?: Record<string, unknown>;
  /** Avisa o responsável no sino. Padrão: true. */
  notifyOwner?: boolean;
}

export interface IntakeResult {
  contact: IContact;
  lead: ILead | null;
  createdContact: boolean;
  createdLead: boolean;
}

/** Contato pelo telefone ou e-mail (o mais antigo, se houver duplicados). */
export async function findContact(phone?: string, email?: string) {
  const key = phoneKey(phone || "");
  const mail = (email || "").trim().toLowerCase();
  return (
    (key ? await Contact.findOne({ phoneKey: key }).sort({ createdAt: 1 }) : null) ||
    (mail ? await Contact.findOne({ email: mail }).sort({ createdAt: 1 }) : null)
  );
}

export async function intakeLead(input: IntakeInput): Promise<IntakeResult> {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const phone = (input.phone || "").trim();
  if (!name && !email && !phone) throw new Error("Informe ao menos nome, telefone ou e-mail.");

  let contact = await findContact(phone, email);
  const createdContact = !contact;
  if (contact) {
    if (name && (!contact.name || contact.name === contact.phone)) contact.name = name;
    if (email && !contact.email) contact.email = email;
    if (phone && !contact.phone) contact.phone = phone;
    if (input.instagram && !contact.instagram) contact.instagram = input.instagram;
    if (contact.isModified()) await contact.save();
  } else {
    contact = await Contact.create({ name: name || phone || email, email, phone, instagram: input.instagram || "", kinds: ["lead"] });
  }

  const funnel = (input.funnelId && (await Funnel.findById(input.funnelId))) || (await Funnel.findOne().sort({ order: 1, createdAt: 1 }));
  const now = new Date();
  const open = await Lead.findOne({ contactId: contact._id, status: "open", ...(input.funnelId && funnel ? { funnelId: funnel._id } : {}) }).sort({
    updatedAt: -1,
  });

  if (open) {
    const leadFunnel = funnel && String(funnel._id) === String(open.funnelId) ? funnel : await Funnel.findById(open.funnelId);
    const stage = input.qualify && leadFunnel ? qualifiedStage(leadFunnel.stages, leadFunnel.qualifiedStageId) : undefined;
    if (stage && String(stage._id) !== String(open.stageId)) {
      open.stageId = stage._id;
      open.status = stage.kind;
      open.subStageId = undefined;
      open.history.push({ at: now, text: `Movida para "${stage.name}" (${input.actor})`, userName: input.actor });
    }
    if (input.notes) open.notes = [open.notes, input.notes].filter(Boolean).join("\n\n");
    if (input.custom && Object.keys(input.custom).length) {
      open.custom = { ...(open.custom || {}), ...input.custom };
      open.markModified("custom");
    }
    open.lastContactAt = now;
    if (open.isModified()) await open.save();
    return { contact, lead: open, createdContact, createdLead: false };
  }

  if (!funnel) return { contact, lead: null, createdContact, createdLead: false };
  const stage =
    (input.qualify && qualifiedStage(funnel.stages, funnel.qualifiedStageId)) ||
    (input.stageId && funnel.stages.find((item) => String(item._id) === String(input.stageId))) ||
    firstOpenStage(funnel.stages);
  if (!stage) return { contact, lead: null, createdContact, createdLead: false };

  const ownerId = input.ownerId || (await orgAdmins())[0];
  if (!ownerId) return { contact, lead: null, createdContact, createdLead: false };
  const lead = await Lead.create({
    ownerId,
    name: contact.name,
    contactId: contact._id,
    contactName: contact.name,
    companyId: contact.companyId,
    funnelId: funnel._id,
    stageId: stage._id,
    status: stage.kind,
    source: input.source,
    notes: input.notes || "",
    custom: input.custom || {},
    lastContactAt: now,
    history: [{ at: now, text: `Recebida por ${input.actor}`, userName: input.actor }],
  });
  if (input.notifyOwner !== false) {
    await notify([lead.ownerId], {
      type: "lead_created",
      title: `Novo lead (${input.actor}): ${contact.name}`,
      body: `Etapa ${stage.name}`,
      link: `/crm/${lead._id}`,
    });
  }
  return { contact, lead, createdContact, createdLead: true };
}
