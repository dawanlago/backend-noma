import type { Types } from "mongoose";
import Contact from "../models/Contact";
import type { IIntegration } from "../models/Integration";
import WhatsAppChat, { type IWhatsAppChat } from "../models/WhatsAppChat";
import WhatsAppMessage, { type IWhatsAppMessage, type WhatsAppMessageKind, type WhatsAppMessageStatus } from "../models/WhatsAppMessage";
import { findIntegration, secret } from "./integrations";
import { phoneKey } from "./phone";

/**
 * Cliente da Z-API (WhatsApp) da empresa atual.
 * Doc: https://developer.z-api.io — todas as chamadas vão para
 * `https://api.z-api.io/instances/{instanceId}/token/{token}/...` com o header `Client-Token`
 * (token de segurança da conta, quando ativado no painel).
 */
const BASE_URL = "https://api.z-api.io/instances";
const TIMEOUT_MS = 15_000;

interface ZapiCredentials {
  instanceId: string;
  token: string;
  clientToken: string;
}

/** Credenciais da integração (null se desativada ou incompleta). */
export function zapiCredentials(doc: IIntegration | null | undefined): ZapiCredentials | null {
  if (!doc?.enabled) return null;
  const instanceId = String(doc.config?.instanceId || "").trim();
  const token = secret(doc, "token");
  if (!instanceId || !token) return null;
  return { instanceId, token, clientToken: secret(doc, "clientToken") };
}

async function currentCredentials() {
  return zapiCredentials(await findIntegration("zapi"));
}

/** A empresa atual tem a Z-API ativa e com instância + token preenchidos? */
export async function zapiReady(): Promise<boolean> {
  return Boolean(await currentCredentials());
}

/**
 * Número no formato da Z-API: DDI + DDD + número, só dígitos (ex.: 5511999999999).
 * Sem DDI (10 ou 11 dígitos) assume Brasil (55). "" se não parecer telefone.
 */
export function zapiPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 10 || digits.length > 15) return "";
  return digits.length <= 11 ? `55${digits}` : digits;
}

async function zapiRequest<T>(creds: ZapiCredentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds.clientToken) headers["Client-Token"] = creds.clientToken;
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/${encodeURIComponent(creds.instanceId)}/token/${encodeURIComponent(creds.token)}/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Não foi possível falar com a Z-API (sem resposta). Tente de novo em instantes.");
  }
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const detail = data && typeof data === "object" ? (data as { error?: unknown; message?: unknown }) : {};
  if (!response.ok) {
    const reason = String(detail.error || detail.message || raw || response.statusText || "").slice(0, 200);
    if (response.status === 401 || response.status === 403 || /client-token|not allowed/i.test(reason)) {
      throw new Error("A Z-API recusou as credenciais. Confira a instância, o token e o Client-Token em Configurações → Integrações.");
    }
    throw new Error(`A Z-API recusou a chamada (${response.status}${reason ? `: ${reason}` : ""}).`);
  }
  return data as T;
}

export interface ZapiStatus {
  /** Integração ativa e com instância + token preenchidos. */
  configured: boolean;
  /** O número está conectado à Z-API (QR code lido). */
  connected: boolean;
  /** O celular está com internet. */
  smartphoneConnected: boolean;
  /** Detalhe devolvido pela Z-API ou erro da chamada. */
  error: string;
}

/** Situação da instância (GET /status). */
export async function zapiStatus(): Promise<ZapiStatus> {
  const creds = await currentCredentials();
  if (!creds) return { configured: false, connected: false, smartphoneConnected: false, error: "" };
  try {
    const data = await zapiRequest<{ connected?: boolean; error?: string; smartphoneConnected?: boolean }>(creds, "GET", "status");
    return {
      configured: true,
      connected: Boolean(data?.connected),
      smartphoneConnected: Boolean(data?.smartphoneConnected),
      error: String(data?.error || ""),
    };
  } catch (error) {
    return { configured: true, connected: false, smartphoneConnected: false, error: (error as Error).message };
  }
}

/**
 * Envia um texto pelo WhatsApp da empresa atual (POST /send-text) e grava a mensagem na conversa.
 * Devolve o id da mensagem no WhatsApp; lança erro com mensagem clara (já em português) se não der.
 */
export async function sendWhatsAppText(
  phone: string,
  text: string,
  options: { sentBy?: { _id: Types.ObjectId; name: string } } = {},
): Promise<string> {
  const creds = await currentCredentials();
  if (!creds) throw new Error("O WhatsApp (Z-API) não está configurado. Ative em Configurações → Integrações.");
  const to = zapiPhone(phone);
  if (!to) throw new Error("Telefone inválido para o WhatsApp. Use DDD + número (ou DDI + DDD + número).");
  const message = String(text || "").trim();
  if (!message) throw new Error("Escreva a mensagem.");
  const data = await zapiRequest<{ zaapId?: string; messageId?: string; id?: string }>(creds, "POST", "send-text", { phone: to, message });
  const messageId = String(data?.messageId || data?.id || "");
  if (!messageId) throw new Error("A Z-API não confirmou o envio da mensagem.");
  // Gravar na caixa de entrada não pode desfazer um envio que já aconteceu.
  try {
    await recordMessage({
      phone: to,
      messageId,
      zaapId: String(data?.zaapId || ""),
      fromMe: true,
      kind: "text",
      text: message,
      status: "PENDING",
      at: new Date(),
      sentBy: options.sentBy?._id,
      sentByName: options.sentBy?.name || "",
    });
  } catch (error) {
    console.error("[zapi] mensagem enviada, mas não gravada:", error);
  }
  return messageId;
}

/** Marca a conversa como lida no celular também (POST /modify-chat). Melhor esforço. */
export async function zapiReadChat(phone: string): Promise<void> {
  const creds = await currentCredentials();
  if (!creds) return;
  try {
    await zapiRequest(creds, "POST", "modify-chat", { phone, action: "read" });
  } catch {
    // Não atrapalha a tela: a conversa já foi marcada como lida no sistema.
  }
}

/* -------------------------------------------------------------------------- */
/* Caixa de entrada (conversas e mensagens gravadas)                          */
/* -------------------------------------------------------------------------- */

/** Texto curto para a lista de conversas. */
export function previewOf(kind: WhatsAppMessageKind, text: string): string {
  const labels: Record<WhatsAppMessageKind, string> = {
    text: "",
    image: "Imagem",
    audio: "Áudio",
    video: "Vídeo",
    document: "Documento",
    sticker: "Figurinha",
    location: "Localização",
    contact: "Contato",
    other: "Mensagem",
  };
  const clean = text.replace(/\s+/g, " ").trim();
  if (kind === "text") return clean.slice(0, 160);
  return clean ? `${labels[kind]}: ${clean}`.slice(0, 160) : labels[kind];
}

/** Conversa do número (cria se não existir) já vinculada ao contato de mesmo telefone. */
export async function ensureChat(phone: string, info: { name?: string; photo?: string } = {}): Promise<IWhatsAppChat> {
  const key = phoneKey(phone);
  let chat = await WhatsAppChat.findOne({ phone });
  if (!chat) {
    const contact = key ? await Contact.findOne({ phoneKey: key }).sort({ createdAt: 1 }).select("_id") : null;
    try {
      chat = await WhatsAppChat.create({ phone, phoneKey: key, name: info.name || "", photo: info.photo || "", contactId: contact?._id });
    } catch (error) {
      // Duas mensagens ao mesmo tempo: a outra criou a conversa primeiro.
      if ((error as { code?: number }).code !== 11000) throw error;
      chat = await WhatsAppChat.findOne({ phone });
      if (!chat) throw error;
    }
    return chat;
  }
  if (info.name && info.name !== chat.name) chat.name = info.name;
  if (info.photo && info.photo !== chat.photo) chat.photo = info.photo;
  if (!chat.contactId && key) {
    const contact = await Contact.findOne({ phoneKey: key }).sort({ createdAt: 1 }).select("_id");
    if (contact) chat.contactId = contact._id;
  }
  if (chat.isModified()) await chat.save();
  return chat;
}

export interface RecordInput {
  phone: string;
  messageId: string;
  zaapId?: string;
  fromMe: boolean;
  kind: WhatsAppMessageKind;
  text: string;
  mediaUrl?: string;
  fileName?: string;
  status: WhatsAppMessageStatus;
  at: Date;
  senderName?: string;
  /** Nome/foto da conversa (só das recebidas). */
  chatName?: string;
  photo?: string;
  sentBy?: Types.ObjectId;
  sentByName?: string;
}

/**
 * Grava a mensagem (sem duplicar pelo messageId) e atualiza o resumo da conversa.
 * `created` é false quando a mensagem já existia (ex.: enviada pela tela e depois avisada pelo webhook).
 */
export async function recordMessage(input: RecordInput): Promise<{ chat: IWhatsAppChat; message: IWhatsAppMessage; created: boolean }> {
  const chat = await ensureChat(input.phone, { name: input.chatName, photo: input.photo });
  const existing = await WhatsAppMessage.findOne({ messageId: input.messageId });
  if (existing) return { chat, message: existing, created: false };

  let message: IWhatsAppMessage;
  try {
    message = await WhatsAppMessage.create({
      chatId: chat._id,
      phone: input.phone,
      messageId: input.messageId,
      zaapId: input.zaapId || "",
      fromMe: input.fromMe,
      kind: input.kind,
      text: input.text,
      mediaUrl: input.mediaUrl || "",
      fileName: input.fileName || "",
      status: input.status,
      senderName: input.senderName || "",
      sentBy: input.sentBy,
      sentByName: input.sentByName || "",
      at: input.at,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const again = await WhatsAppMessage.findOne({ messageId: input.messageId });
    if (!again) throw error;
    return { chat, message: again, created: false };
  }

  // Só a mensagem mais nova vira o resumo; responder (pelo sistema ou pelo celular) zera as não lidas.
  const update: Record<string, unknown> = {};
  if (!chat.lastMessageAt || input.at >= chat.lastMessageAt) {
    update.$set = { lastMessageText: previewOf(input.kind, input.text), lastMessageAt: input.at, lastFromMe: input.fromMe };
  }
  if (input.fromMe) update.$set = { ...((update.$set as object) || {}), unread: 0 };
  else update.$inc = { unread: 1 };
  const updated = await WhatsAppChat.findOneAndUpdate({ _id: chat._id }, update, { new: true });
  return { chat: updated || chat, message, created: true };
}
