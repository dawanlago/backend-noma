import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

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
  },
  { timestamps: true, minimize: false },
);

FormResponseSchema.index({ formId: 1, createdAt: -1 });

FormResponseSchema.plugin(tenantPlugin);

const FormResponse: Model<IFormResponse> =
  models.FormResponse || model<IFormResponse>("FormResponse", FormResponseSchema);

export default FormResponse;
