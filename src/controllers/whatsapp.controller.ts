import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, Types } from "mongoose";
import Contact from "../models/Contact";
import type { IIntegration } from "../models/Integration";
import Lead from "../models/Lead";
import WhatsAppChat, { type IWhatsAppChat } from "../models/WhatsAppChat";
import WhatsAppMessage, { type WhatsAppMessageKind, type WhatsAppMessageStatus } from "../models/WhatsAppMessage";
import { findIntegration } from "../lib/integrations";
import { intakeLead } from "../lib/leadIntake";
import { phoneKey } from "../lib/phone";
import { ensureChat, recordMessage, sendWhatsAppText, zapiPhone, zapiReadChat, zapiStatus } from "../lib/zapi";

/* -------------------------------------------------------------------------- */
/* Webhook da Z-API                                                           */
/* -------------------------------------------------------------------------- */

/** Ordem dos status: o webhook pode chegar fora de ordem e não deve "voltar" uma mensagem lida para enviada. */
const STATUS_RANK: Record<string, number> = { PENDING: 0, SENT: 1, RECEIVED: 2, READ: 3, PLAYED: 4 };

type Payload = Record<string, unknown>;

function obj(value: unknown): Payload | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** Conteúdo da mensagem recebida (campos do webhook "Ao receber" da Z-API). */
function contentOf(body: Payload): { kind: WhatsAppMessageKind; text: string; mediaUrl: string; fileName: string } | null {
  const text = obj(body.text);
  if (text) return { kind: "text", text: str(text.message), mediaUrl: "", fileName: "" };
  const image = obj(body.image);
  if (image) return { kind: "image", text: str(image.caption), mediaUrl: str(image.imageUrl), fileName: "" };
  const audio = obj(body.audio);
  if (audio) return { kind: "audio", text: "", mediaUrl: str(audio.audioUrl), fileName: "" };
  const video = obj(body.video);
  if (video) return { kind: "video", text: str(video.caption), mediaUrl: str(video.videoUrl), fileName: "" };
  const document = obj(body.document);
  if (document) {
    const fileName = str(document.fileName) || str(document.title);
    return { kind: "document", text: fileName, mediaUrl: str(document.documentUrl), fileName };
  }
  const sticker = obj(body.sticker);
  if (sticker) return { kind: "sticker", text: "", mediaUrl: str(sticker.stickerUrl), fileName: "" };
  const location = obj(body.location);
  if (location) return { kind: "location", text: str(location.address), mediaUrl: str(location.url), fileName: "" };
  const contact = obj(body.contact);
  if (contact) return { kind: "contact", text: str(contact.displayName), mediaUrl: "", fileName: "" };
  // Reações, avisos (notification) e outros eventos não viram mensagem na conversa.
  if (body.reaction || body.notification) return null;
  return { kind: "other", text: "", mediaUrl: "", fileName: "" };
}

/** Só conversas individuais: grupos, canais, status e listas de transmissão ficam de fora. */
function isPrivateChat(body: Payload, phone: string) {
  return !body.isGroup && !body.isNewsletter && !body.broadcast && /^\d{8,15}$/.test(phone);
}

async function handleReceived(integration: IIntegration, body: Payload) {
  const phone = str(body.phone);
  const messageId = str(body.messageId);
  if (!messageId || !isPrivateChat(body, phone)) return;
  const content = contentOf(body);
  if (!content) return;
  const fromMe = body.fromMe === true;
  const moment = Number(body.momment);
  const at = Number.isFinite(moment) && moment > 0 ? new Date(moment) : new Date();
  const status = (STATUS_RANK[str(body.status)] !== undefined ? str(body.status) : fromMe ? "SENT" : "RECEIVED") as WhatsAppMessageStatus;

  // Mensagem editada: troca o texto da que já está gravada.
  if (body.isEdit === true) {
    const edited = await WhatsAppMessage.findOneAndUpdate({ messageId }, { $set: { text: content.text } }, { new: true });
    if (edited) return;
  }

  const { chat, created } = await recordMessage({
    phone,
    messageId,
    fromMe,
    ...content,
    status,
    at,
    senderName: str(body.senderName),
    // Nas enviadas pelo celular, senderName é o próprio número da produtora; o nome da conversa vem em chatName.
    chatName: str(body.chatName) || (fromMe ? "" : str(body.senderName)),
    photo: fromMe ? "" : str(body.senderPhoto) || str(body.photo),
  });
  if (!created || fromMe) return;

  // Lead automático: quem escreve e não tem negociação aberta entra no funil configurado.
  const config = integration.config || {};
  if (!config.autoCreateLeads) return;
  if (chat.contactId && (await Lead.exists({ contactId: chat.contactId, status: "open" }))) return;
  const result = await intakeLead({
    source: "WhatsApp",
    actor: "WhatsApp",
    phone,
    name: str(body.senderName) || str(body.chatName),
    funnelId: str(config.funnelId) && isValidObjectId(str(config.funnelId)) ? str(config.funnelId) : undefined,
    ownerId: str(config.ownerId) && isValidObjectId(str(config.ownerId)) ? str(config.ownerId) : undefined,
  });
  if (String(chat.contactId || "") !== String(result.contact._id)) {
    await WhatsAppChat.updateOne({ _id: chat._id }, { $set: { contactId: result.contact._id } });
  }
}

/** "Ao enviar": confirma que a Z-API mandou (ou não) a mensagem. */
async function handleDelivery(body: Payload) {
  const messageId = str(body.messageId);
  const zaapId = str(body.zaapId);
  if (!messageId && !zaapId) return;
  const error = str(body.error);
  const filter = messageId ? { messageId } : { zaapId };
  if (error) await WhatsAppMessage.updateOne(filter, { $set: { status: "FAILED", error } });
  else await WhatsAppMessage.updateOne({ ...filter, status: "PENDING" }, { $set: { status: "SENT" } });
}

/** "Status da mensagem": entregue, lida, ouvida. READ_BY_ME = lida no celular da produtora. */
async function handleStatus(body: Payload) {
  const ids = Array.isArray(body.ids) ? body.ids.map(str).filter(Boolean) : [];
  const status = str(body.status);
  if (!ids.length) return;
  if (status === "READ_BY_ME") {
    const phone = str(body.phone);
    if (phone) await WhatsAppChat.updateOne({ phone }, { $set: { unread: 0 } });
    return;
  }
  const rank = STATUS_RANK[status];
  if (rank === undefined) return;
  const lower = Object.keys(STATUS_RANK).filter((key) => STATUS_RANK[key] < rank) as WhatsAppMessageStatus[];
  await WhatsAppMessage.updateMany({ messageId: { $in: ids }, status: { $in: lower } }, { $set: { status } });
}

/**
 * POST /public/webhooks/zapi/:hookKey — eventos da Z-API (Ao receber, Ao enviar, Status da mensagem).
 * Sempre responde 200 (a Z-API não precisa reenviar): integração desligada ou corpo estranho são ignorados.
 */
export async function zapiWebhook(req: Request, res: Response) {
  const integration = res.locals.integration as IIntegration;
  const body = obj(req.body);
  const type = str(body?.type);
  const instanceId = String(integration.config?.instanceId || "");
  // Corpo da Z-API: tem `type` e, quando a instância está configurada, é dela.
  const valid = body && type && (!instanceId || !body.instanceId || str(body.instanceId) === instanceId);
  if (integration.enabled && valid) {
    try {
      if (type === "ReceivedCallback") await handleReceived(integration, body);
      else if (type === "DeliveryCallback") await handleDelivery(body);
      else if (type === "MessageStatusCallback") await handleStatus(body);
    } catch (error) {
      console.error("[zapi] webhook:", error);
    }
  }
  res.json({ ok: true });
}

/* -------------------------------------------------------------------------- */
/* Caixa de entrada (usuário logado, módulo CRM)                              */
/* -------------------------------------------------------------------------- */

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Conversas com o contato e a negociação aberta mais recente de cada um. */
async function withLinks(chats: IWhatsAppChat[]) {
  const contactIds = [...new Set(chats.map((chat) => chat.contactId).filter(Boolean).map(String))];
  const [contacts, leads] = await Promise.all([
    contactIds.length ? Contact.find({ _id: { $in: contactIds } }).select("name phone photo").lean() : [],
    contactIds.length
      ? Lead.find({ contactId: { $in: contactIds }, status: "open" }).sort({ updatedAt: -1 }).select("name contactId status funnelId stageId").lean()
      : [],
  ]);
  const contactById = new Map(contacts.map((contact) => [String(contact._id), contact]));
  const leadByContact = new Map<string, (typeof leads)[number]>();
  leads.forEach((lead) => {
    const key = String(lead.contactId);
    if (!leadByContact.has(key)) leadByContact.set(key, lead);
  });
  return chats.map((chat) => {
    const contact = chat.contactId ? contactById.get(String(chat.contactId)) : undefined;
    const lead = chat.contactId ? leadByContact.get(String(chat.contactId)) : undefined;
    return {
      _id: chat._id,
      phone: chat.phone,
      name: chat.name,
      photo: chat.photo,
      lastMessageText: chat.lastMessageText,
      lastMessageAt: chat.lastMessageAt,
      lastFromMe: chat.lastFromMe,
      unread: chat.unread,
      contact: contact ? { _id: contact._id, name: contact.name, phone: contact.phone, photo: contact.photo } : null,
      lead: lead ? { _id: lead._id, name: lead.name, status: lead.status, funnelId: lead.funnelId, stageId: lead.stageId } : null,
    };
  });
}

async function findChat(req: Request, res: Response) {
  const chat = isValidObjectId(req.params.id) ? await WhatsAppChat.findById(req.params.id) : null;
  if (!chat) res.status(404).json({ error: "Conversa não encontrada." });
  return chat;
}

/** GET /whatsapp/status — integração configurada e situação da instância. */
export async function getStatus(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await zapiStatus() });
  } catch (error) {
    next(error);
  }
}

/** GET /whatsapp/chats?q=&unread=1 — conversas, mais recentes primeiro. */
export async function listChats(req: Request, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q || "").trim();
    const filter: Record<string, unknown> = {};
    if (req.query.unread === "1" || req.query.unread === "true") filter.unread = { $gt: 0 };
    if (q) {
      const pattern = new RegExp(escapeRegex(q), "i");
      const or: Record<string, unknown>[] = [{ name: pattern }, { lastMessageText: pattern }];
      const digits = q.replace(/\D/g, "");
      if (digits.length >= 3) or.push({ phone: new RegExp(escapeRegex(digits)) });
      const contacts = await Contact.find({ name: pattern }).select("_id").limit(200).lean();
      if (contacts.length) or.push({ contactId: { $in: contacts.map((contact) => contact._id) } });
      filter.$or = or;
    }
    const chats = await WhatsAppChat.find(filter).sort({ lastMessageAt: -1, updatedAt: -1 }).limit(200);
    const unreadTotal = await WhatsAppChat.countDocuments({ unread: { $gt: 0 } });
    res.json({ data: { items: await withLinks(chats), unreadChats: unreadTotal } });
  } catch (error) {
    next(error);
  }
}

/** GET /whatsapp/chats/:id/messages?before=<ISO>&limit=50 — página de mensagens (antigas → novas). */
export async function listMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    const limit = Math.min(100, Math.max(1, Math.round(Number(req.query.limit) || 50)));
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const filter: Record<string, unknown> = { chatId: chat._id };
    if (before && !Number.isNaN(before.getTime())) filter.at = { $lt: before };
    const page = await WhatsAppMessage.find(filter)
      .sort({ at: -1, _id: -1 })
      .limit(limit + 1)
      .select("messageId fromMe kind text mediaUrl fileName status error senderName sentByName at")
      .lean();
    const hasMore = page.length > limit;
    const messages = page.slice(0, limit).reverse();
    const [view] = await withLinks([chat]);
    res.json({ data: { chat: view, messages, hasMore } });
  } catch (error) {
    next(error);
  }
}

/** POST /whatsapp/chats/:id/messages { text } — envia pela Z-API e grava como enviada. */
export async function sendToChat(req: Request, res: Response, next: NextFunction) {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    const text = String(req.body?.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "Escreva a mensagem." });
      return;
    }
    if (text.length > 4096) {
      res.status(400).json({ error: "Mensagem longa demais (máximo de 4096 caracteres)." });
      return;
    }
    let messageId: string;
    try {
      messageId = await sendWhatsAppText(chat.phone, text, { sentBy: { _id: req.user!._id, name: req.user!.name } });
    } catch (error) {
      res.status(502).json({ error: (error as Error).message });
      return;
    }
    const message = await WhatsAppMessage.findOne({ messageId })
      .select("messageId fromMe kind text mediaUrl fileName status error senderName sentByName at")
      .lean();
    res.status(201).json({ data: message });
  } catch (error) {
    next(error);
  }
}

/** POST /whatsapp/send { phone, text } — começa (ou continua) a conversa com um número. Devolve a conversa. */
export async function sendToPhone(req: Request, res: Response, next: NextFunction) {
  try {
    const phone = zapiPhone(String(req.body?.phone || ""));
    const text = String(req.body?.text || "").trim();
    if (!phone) {
      res.status(400).json({ error: "Telefone inválido para o WhatsApp." });
      return;
    }
    if (!text) {
      res.status(400).json({ error: "Escreva a mensagem." });
      return;
    }
    // Usa a conversa que já existe com esse número, mesmo que gravada com/sem o 9.
    const key = phoneKey(phone);
    const existing = key ? await WhatsAppChat.findOne({ phoneKey: key }).sort({ lastMessageAt: -1 }) : null;
    const target = existing?.phone || phone;
    try {
      await sendWhatsAppText(target, text, { sentBy: { _id: req.user!._id, name: req.user!.name } });
    } catch (error) {
      res.status(502).json({ error: (error as Error).message });
      return;
    }
    const chat = await ensureChat(target);
    const [view] = await withLinks([chat]);
    res.status(201).json({ data: view });
  } catch (error) {
    next(error);
  }
}

/** POST /whatsapp/chats/:id/read — zera as não lidas (e marca como lida no celular). */
export async function markChatRead(req: Request, res: Response, next: NextFunction) {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    if (chat.unread) {
      await WhatsAppChat.updateOne({ _id: chat._id }, { $set: { unread: 0 } });
      void zapiReadChat(chat.phone);
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** POST /whatsapp/chats/:id/lead — cria contato (se preciso) e negociação para a conversa. */
export async function createChatLead(req: Request, res: Response, next: NextFunction) {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    const integration = await findIntegration("zapi");
    const funnelId = String(req.body?.funnelId || integration?.config?.funnelId || "");
    const contact = chat.contactId ? await Contact.findById(chat.contactId).select("name phone") : null;
    const result = await intakeLead({
      source: "WhatsApp",
      actor: req.user!.name,
      name: contact?.name || chat.name,
      phone: contact?.phone || chat.phone,
      funnelId: isValidObjectId(funnelId) ? new Types.ObjectId(funnelId) : undefined,
      ownerId: req.user!._id,
      notifyOwner: false,
    });
    if (String(chat.contactId || "") !== String(result.contact._id)) {
      chat.contactId = result.contact._id;
      await chat.save();
    }
    if (!result.lead) {
      res.status(400).json({ error: "Não há funil com etapa aberta para criar a negociação." });
      return;
    }
    res.status(201).json({ data: { contactId: result.contact._id, leadId: result.lead._id, created: result.createdLead } });
  } catch (error) {
    next(error);
  }
}
