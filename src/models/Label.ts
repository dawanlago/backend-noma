import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface ILabel extends Document {
  _id: Types.ObjectId;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

const LabelSchema = new Schema<ILabel>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    color: { type: String, required: true, default: "#9B7250" },
  },
  { timestamps: true },
);

const Label: Model<ILabel> = models.Label || model<ILabel>("Label", LabelSchema);

export default Label;
