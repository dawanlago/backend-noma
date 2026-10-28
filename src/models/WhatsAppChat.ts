import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/**
 * Conversa do WhatsApp (Z-API) com um número. Guarda o resumo para a caixa de entrada
 * (última mensagem, não lidas) e o vínculo com o contato da base (pelo phoneKey).
 */
export interface IWhatsAppChat extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  /** Número como o WhatsApp manda (DDI + DDD + número, só dígitos). */
  phone: string;
  /** Telefone normalizado (lib/phone), para achar o contato. */
  phoneKey: string;
  /** Nome exibido no WhatsApp (quando não há contato vinculado). */
  name: string;
  photo: string;
  contactId?: Types.ObjectId;
  lastMessageText: string;
  lastMessageAt?: Date;
  lastFromMe: boolean;
  unread: number;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppChatSchema = new Schema<IWhatsAppChat>(
  {
    phone: { type: String, required: true, trim: true },
    phoneKey: { type: String, default: "" },
    name: { type: String, trim: true, default: "" },
    photo: { type: String, default: "" },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date },
    lastFromMe: { type: Boolean, default: false },
    unread: { type: Number, default: 0 },
  },
  { timestamps: true },
);

WhatsAppChatSchema.plugin(tenantPlugin);
WhatsAppChatSchema.index({ orgId: 1, phone: 1 }, { unique: true });
WhatsAppChatSchema.index({ orgId: 1, lastMessageAt: -1 });
WhatsAppChatSchema.index({ orgId: 1, phoneKey: 1 });

const WhatsAppChat: Model<IWhatsAppChat> = models.WhatsAppChat || model<IWhatsAppChat>("WhatsAppChat", WhatsAppChatSchema);

export default WhatsAppChat;
