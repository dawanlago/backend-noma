import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export type WhatsAppMessageKind = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "other";
/** Status da Z-API (PENDING, SENT, RECEIVED, READ, PLAYED) mais FAILED quando o envio deu erro. */
export type WhatsAppMessageStatus = "PENDING" | "SENT" | "RECEIVED" | "READ" | "PLAYED" | "FAILED";

/** Mensagem de uma conversa do WhatsApp (recebida ou enviada). */
export interface IWhatsAppMessage extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  chatId: Types.ObjectId;
  phone: string;
  /** Id da mensagem no WhatsApp (messageId da Z-API). */
  messageId: string;
  /** Id da mensagem na fila da Z-API (só nas enviadas pela API). */
  zaapId: string;
  fromMe: boolean;
  kind: WhatsAppMessageKind;
  /** Texto, legenda da mídia ou descrição curta (ex.: nome do arquivo). */
  text: string;
  mediaUrl: string;
  fileName: string;
  status: WhatsAppMessageStatus;
  error: string;
  senderName: string;
  /** Usuário do sistema que enviou (mensagens mandadas pela tela ou por automação). */
  sentBy?: Types.ObjectId;
  sentByName: string;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppMessageSchema = new Schema<IWhatsAppMessage>(
  {
    chatId: { type: Schema.Types.ObjectId, ref: "WhatsAppChat", required: true },
    phone: { type: String, required: true, trim: true },
    messageId: { type: String, required: true },
    zaapId: { type: String, default: "" },
    fromMe: { type: Boolean, default: false },
    kind: { type: String, default: "text" },
    text: { type: String, default: "" },
    mediaUrl: { type: String, default: "" },
    fileName: { type: String, default: "" },
    status: { type: String, default: "RECEIVED" },
    error: { type: String, default: "" },
    senderName: { type: String, trim: true, default: "" },
    sentBy: { type: Schema.Types.ObjectId, ref: "User" },
    sentByName: { type: String, trim: true, default: "" },
    at: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

WhatsAppMessageSchema.plugin(tenantPlugin);
WhatsAppMessageSchema.index({ orgId: 1, messageId: 1 }, { unique: true });
WhatsAppMessageSchema.index({ orgId: 1, chatId: 1, at: -1 });

const WhatsAppMessage: Model<IWhatsAppMessage> =
  models.WhatsAppMessage || model<IWhatsAppMessage>("WhatsAppMessage", WhatsAppMessageSchema);

export default WhatsAppMessage;
