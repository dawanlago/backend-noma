import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/** Cada passo respondido no link público (histórico do preenchimento). */
export interface IFormResponseEvent {
  at: Date;
  fieldKey: string;
  value: string;
}

/** Máximo de passos guardados no histórico de cada resposta. */
export const MAX_RESPONSE_EVENTS = 100;

export interface IFormResponse extends Document {
  _id: Types.ObjectId;
  formId: Types.ObjectId;
  ownerId: Types.ObjectId;
  /** Respostas por chave do campo. */
  answers: Record<string, unknown>;
  contactId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  /** Preenchido pelo link enviado na negociação. */
  inviteId?: Types.ObjectId;
  /** partial = salvo a cada pergunta, ainda sem envio final (não cria contato/negociação). Sem campo = complete (antigas). */
  status: "partial" | "complete";
  /** Id aleatório guardado no navegador: o mesmo preenchimento continua depois de recarregar. */
  sessionId?: string;
  /** Índice da última pergunta respondida e quantas têm resposta. */
  lastStep: number;
  stepsAnswered: number;
  events: IFormResponseEvent[];
  completedAt?: Date;
  /** Pergunta "Data do evento": data, dias de antecedência no envio e se caiu na regra de indisponibilidade. */
  eventDate?: string;
  daysUntilEvent?: number;
  unavailable?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FormResponseSchema = new Schema<IFormResponse>(
  {
    formId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    answers: { type: Schema.Types.Mixed, default: {} },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    inviteId: { type: Schema.Types.ObjectId, ref: "FormInvite" },
    status: { type: String, enum: ["partial", "complete"], default: "complete" },
    sessionId: { type: String },
    lastStep: { type: Number, default: 0 },
    stepsAnswered: { type: Number, default: 0 },
    events: { type: [{ _id: false, at: Date, fieldKey: String, value: String }], default: [] },
    completedAt: { type: Date },
    eventDate: { type: String },
    daysUntilEvent: { type: Number },
    unavailable: { type: Boolean },
  },
  { timestamps: true, minimize: false },
);

FormResponseSchema.index({ formId: 1, createdAt: -1 });
// Um preenchimento por navegador: o progresso e o envio final caem no mesmo registro.
FormResponseSchema.index({ formId: 1, sessionId: 1 }, { unique: true, partialFilterExpression: { sessionId: { $type: "string" } } });
FormResponseSchema.index({ inviteId: 1 });

FormResponseSchema.plugin(tenantPlugin);

const FormResponse: Model<IFormResponse> =
  models.FormResponse || model<IFormResponse>("FormResponse", FormResponseSchema);

export default FormResponse;
