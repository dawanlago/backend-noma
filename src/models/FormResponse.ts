import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { FormFieldType } from "../types";

export interface IFormAnswer {
  key: string;
  label: string;
  type: FormFieldType;
  value: unknown;
}

export interface IFormResponse extends Document {
  _id: Types.ObjectId;
  formId: Types.ObjectId;
  dealId: Types.ObjectId;
  contactId: Types.ObjectId;
  answers: IFormAnswer[];
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FormAnswerSchema = new Schema<IFormAnswer>(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, required: true },
    value: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const FormResponseSchema = new Schema<IFormResponse>(
  {
    formId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
    dealId: { type: Schema.Types.ObjectId, ref: "Deal", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    answers: { type: [FormAnswerSchema], default: [] },
    submittedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

FormResponseSchema.index({ dealId: 1, submittedAt: -1 });
FormResponseSchema.index({ dealId: 1, formId: 1 }, { unique: true });
FormResponseSchema.index({ formId: 1, contactId: 1 });

const FormResponse: Model<IFormResponse> =
  models.FormResponse || model<IFormResponse>("FormResponse", FormResponseSchema);

export default FormResponse;
