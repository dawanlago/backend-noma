import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";
import type { LeadStatus, LeadTemperature } from "../types";

export interface ILeadProduct {
  productId?: Types.ObjectId;
  name: string;
  /** Descrição só desta negociação (começa igual à do catálogo). */
  description?: string;
  price: number;
}

/** Parecer registrado na negociação. Só o admin altera ou apaga. */
export interface ILeadComment {
  _id: Types.ObjectId;
  text: string;
  authorId: Types.ObjectId;
  authorName: string;
  createdAt: Date;
  editedAt?: Date;
}

export interface ILeadHistory {
  at: Date;
  text: string;
  userName: string;
}

/** Negociação do CRM (o "card" do funil). */
export interface ILead extends Document {
  _id: Types.ObjectId;
  /** Responsável pela negociação (pode ser trocado por quem vê todas). */
  ownerId: Types.ObjectId;
  /** Quem criou a negociação (não muda). */
  createdBy?: Types.ObjectId;
  name: string;
  contactId?: Types.ObjectId;
  companyId?: Types.ObjectId;
  /** Nome do contato e da empresa copiados para os cards e buscas. */
  contactName: string;
  company: string;
  funnelId: Types.ObjectId;
  stageId: Types.ObjectId;
  status: LeadStatus;
  service: string;
  products: ILeadProduct[];
  /** Valor avulso, somado aos produtos. */
  customValue: number;
  value: number;
  temperature: LeadTemperature;
  nextActionDate?: Date;
  source: string;
  notes: string;
  custom: Record<string, unknown>;
  comments: Types.DocumentArray<ILeadComment & Types.Subdocument>;
  history: ILeadHistory[];
  wonAt?: Date;
  lostAt?: Date;
  /** Motivo da perda (lista "lostReason") e observação; limpos ao reabrir. */
  lostReason?: string;
  lostNote?: string;
  /** Quando entrou no funil atual e na etapa atual (métricas do card). */
  funnelEnteredAt?: Date;
  stageEnteredAt?: Date;
  /** Microetapa atual (dentro da etapa) e desde quando está nela. */
  subStageId?: Types.ObjectId;
  subStageEnteredAt?: Date;
  /** Fechamento: valor oferecido na proposta e valor fechado (a diferença é o desconto). */
  offeredValue?: number;
  closedValue?: number;
  /** Último contato com o cliente: parecer registrado ou atividade concluída. */
  lastContactAt?: Date;
  /** Data do evento (YYYY-MM-DD) vinda do formulário e se ela caiu na regra de indisponibilidade. */
  eventDate?: string;
  eventUnavailable?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LeadProductSchema = new Schema<ILeadProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, trim: true, required: true },
    description: { type: String, trim: true, default: "" },
    price: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const LeadCommentSchema = new Schema<ILeadComment>({
  text: { type: String, required: true, trim: true },
  authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  authorName: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  editedAt: { type: Date },
});

const LeadHistorySchema = new Schema<ILeadHistory>(
  {
    at: { type: Date, default: Date.now },
    text: { type: String, required: true },
    userName: { type: String, default: "" },
  },
  { _id: false },
);

const LeadSchema = new Schema<ILead>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    contactName: { type: String, trim: true, default: "" },
    company: { type: String, trim: true, default: "" },
    funnelId: { type: Schema.Types.ObjectId, ref: "Funnel", required: true },
    stageId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ["open", "won", "lost"], default: "open" },
    service: { type: String, trim: true, default: "" },
    products: { type: [LeadProductSchema], default: [] },
    customValue: { type: Number, min: 0, default: 0 },
    value: { type: Number, min: 0, default: 0 },
    temperature: { type: String, enum: ["cold", "warm", "hot"], default: "warm" },
    nextActionDate: { type: Date },
    source: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    custom: { type: Schema.Types.Mixed, default: {} },
    comments: { type: [LeadCommentSchema], default: [] },
    history: { type: [LeadHistorySchema], default: [] },
    wonAt: { type: Date },
    lostAt: { type: Date },
    lostReason: { type: String, trim: true },
    lostNote: { type: String, trim: true },
    funnelEnteredAt: { type: Date },
    stageEnteredAt: { type: Date },
    subStageId: { type: Schema.Types.ObjectId },
    subStageEnteredAt: { type: Date },
    lastContactAt: { type: Date },
    eventDate: { type: String, trim: true },
    eventUnavailable: { type: Boolean },
    offeredValue: { type: Number, min: 0 },
    closedValue: { type: Number, min: 0 },
  },
  { timestamps: true, minimize: false },
);

LeadSchema.pre("save", function syncDerived() {
  const productsTotal = (this.products || []).reduce((total, item) => total + (Number(item.price) || 0), 0);
  this.value = Math.round((productsTotal + (Number(this.customValue) || 0)) * 100) / 100;
  if (this.isNew && !this.createdBy) this.createdBy = this.ownerId;
  // Fora de "perdida" não há motivo de perda.
  if (this.status !== "lost") {
    this.lostReason = undefined;
    this.lostNote = undefined;
  }
  const now = new Date();
  if (this.isNew || this.isModified("funnelId")) this.funnelEnteredAt = now;
  if (this.isNew || this.isModified("stageId")) this.stageEnteredAt = now;
  if (this.isNew || this.isModified("stageId") || this.isModified("subStageId")) this.subStageEnteredAt = now;
  if (this.isModified("status")) {
    this.wonAt = this.status === "won" ? this.wonAt || new Date() : undefined;
    this.lostAt = this.status === "lost" ? this.lostAt || new Date() : undefined;
  }
});

LeadSchema.index({ ownerId: 1, funnelId: 1 });
LeadSchema.index({ contactId: 1 });
LeadSchema.index({ companyId: 1 });

LeadSchema.plugin(tenantPlugin);

const Lead: Model<ILead> = models.Lead || model<ILead>("Lead", LeadSchema);

export default Lead;
