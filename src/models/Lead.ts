import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { LEAD_SERVICES, LEAD_STAGES, type LeadStage } from "../types";

export interface ILead extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  company: string;
  service: string;
  value: number;
  stage: LeadStage;
  nextActionDate?: Date;
  source: string;
  notes: string;
  wonAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILead>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true, default: "" },
    service: { type: String, enum: LEAD_SERVICES, default: "Conteúdo mensal" },
    value: { type: Number, min: 0, default: 0 },
    stage: { type: String, enum: LEAD_STAGES, default: "new" },
    nextActionDate: { type: Date },
    source: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    wonAt: { type: Date },
  },
  { timestamps: true },
);

LeadSchema.pre("save", function setWonAt() {
  if (this.isModified("stage")) {
    this.wonAt = this.stage === "won" ? this.wonAt || new Date() : undefined;
  }
});

LeadSchema.index({ ownerId: 1, stage: 1 });

const Lead: Model<ILead> = models.Lead || model<ILead>("Lead", LeadSchema);

export default Lead;
