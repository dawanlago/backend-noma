import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { DealSource, DealTemperature } from "../types";

export interface IDealNote {
  _id: Types.ObjectId;
  stageId: Types.ObjectId;
  date: Date;
  text: string;
  userId: Types.ObjectId;
}

export interface IDealDossier {
  manualNotes: string;
  aiSummary: string;
  aiGeneratedAt?: Date;
  aiModel?: string;
}

export interface IDeal extends Document {
  _id: Types.ObjectId;
  title: string;
  contactId: Types.ObjectId;
  companyId?: Types.ObjectId;
  funnelId: Types.ObjectId;
  currentStageId: Types.ObjectId;
  value: number;
  temperature: DealTemperature;
  productIds: Types.ObjectId[];
  creatorUserId: Types.ObjectId;
  ownerUserId?: Types.ObjectId;
  closedTransactionId?: Types.ObjectId;
  files: string[];
  notes: IDealNote[];
  taskIds: Types.ObjectId[];
  labelIds: Types.ObjectId[];
  source: DealSource;
  dossier: IDealDossier;
  createdAt: Date;
  updatedAt: Date;
}

const DealNoteSchema = new Schema<IDealNote>(
  {
    stageId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true, default: Date.now },
    text: { type: String, required: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: true },
);

const DealDossierSchema = new Schema<IDealDossier>(
  {
    manualNotes: { type: String, default: "" },
    aiSummary: { type: String, default: "" },
    aiGeneratedAt: { type: Date },
    aiModel: { type: String },
  },
  { _id: false },
);

const DealSchema = new Schema<IDeal>(
  {
    title: { type: String, required: true, trim: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    funnelId: { type: Schema.Types.ObjectId, ref: "Funnel", required: true },
    currentStageId: { type: Schema.Types.ObjectId, required: true },
    value: { type: Number, required: true, default: 0, min: 0 },
    temperature: {
      type: String,
      enum: ["cold", "warm", "hot"],
      default: "cold",
    },
    productIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    creatorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User" },
    closedTransactionId: { type: Schema.Types.ObjectId, ref: "Transaction" },
    files: [{ type: String }],
    notes: { type: [DealNoteSchema], default: [] },
    taskIds: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    labelIds: [{ type: Schema.Types.ObjectId, ref: "Label" }],
    source: {
      type: String,
      enum: ["whatsapp", "instagram", "landing_page", "manual"],
      default: "manual",
    },
    dossier: {
      type: DealDossierSchema,
      default: () => ({ manualNotes: "", aiSummary: "" }),
    },
  },
  { timestamps: true },
);

DealSchema.index({ funnelId: 1, currentStageId: 1 });
DealSchema.index({ contactId: 1 });
DealSchema.index({ companyId: 1 });
DealSchema.index({ creatorUserId: 1 });
DealSchema.index({ ownerUserId: 1 });

const Deal: Model<IDeal> = models.Deal || model<IDeal>("Deal", DealSchema);

export default Deal;
