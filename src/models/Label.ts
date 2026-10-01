import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface ILabel extends Document {
  _id: Types.ObjectId;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

const LabelSchema = new Schema<ILabel>(
  {
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true, default: "#9B7250" },
  },
  { timestamps: true },
);

LabelSchema.plugin(tenantPlugin);
LabelSchema.index({ orgId: 1, name: 1 }, { unique: true });

const Label: Model<ILabel> = models.Label || model<ILabel>("Label", LabelSchema);

export default Label;
