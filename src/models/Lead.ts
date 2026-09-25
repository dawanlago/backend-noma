import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { LeadStatus, LeadTemperature } from "../types";

export interface ILeadProduct {
  productId?: Types.ObjectId;
  name: string;
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
  ownerId: Types.ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

const LeadProductSchema = new Schema<ILeadProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, trim: true, required: true },
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
  },
  { timestamps: true, minimize: false },
);

LeadSchema.pre("save", function syncDerived() {
  const productsTotal = (this.products || []).reduce((total, item) => total + (Number(item.price) || 0), 0);
  this.value = Math.round((productsTotal + (Number(this.customValue) || 0)) * 100) / 100;
  if (this.isModified("status")) {
    this.wonAt = this.status === "won" ? this.wonAt || new Date() : undefined;
    this.lostAt = this.status === "lost" ? this.lostAt || new Date() : undefined;
  }
});

LeadSchema.index({ ownerId: 1, funnelId: 1 });
LeadSchema.index({ contactId: 1 });
LeadSchema.index({ companyId: 1 });

const Lead: Model<ILead> = models.Lead || model<ILead>("Lead", LeadSchema);

export default Lead;
