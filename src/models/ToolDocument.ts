import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { ToolKey } from "../types";

/** Documentos salvos das ferramentas (propostas, contratos, orçamentos e briefings). */
export interface IToolDocument extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  tool: ToolKey;
  title: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ToolDocumentSchema = new Schema<IToolDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tool: { type: String, enum: ["proposal", "contract", "budget", "briefing"], required: true },
    title: { type: String, trim: true, default: "Sem título" },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

ToolDocumentSchema.index({ ownerId: 1, tool: 1, updatedAt: -1 });

const ToolDocument: Model<IToolDocument> =
  models.ToolDocument || model<IToolDocument>("ToolDocument", ToolDocumentSchema);

export default ToolDocument;
