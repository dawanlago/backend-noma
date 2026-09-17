import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { FormFieldType } from "../types";

export interface IFormField {
  _id?: Types.ObjectId;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  order: number;
}

export interface IForm extends Document {
  _id: Types.ObjectId;
  name: string;
  funnelId?: Types.ObjectId;
  isActive: boolean;
  fields: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

const FormSchema = new Schema<IForm>(
  {
    name: { type: String, required: true, trim: true },
    funnelId: { type: Schema.Types.ObjectId, ref: "Funnel" },
    isActive: { type: Boolean, default: true },
    fields: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

const Form: Model<IForm> = models.Form || model<IForm>("Form", FormSchema);

export default Form;
