import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export type FormInviteStatus = "pending" | "submitted";

export interface IFormInvite extends Document {
  _id: Types.ObjectId;
  code: string;
  formId: Types.ObjectId;
  dealId: Types.ObjectId;
  contactId: Types.ObjectId;
  status: FormInviteStatus;
  responseId?: Types.ObjectId;
  sentAt: Date;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FormInviteSchema = new Schema<IFormInvite>(
  {
    code: { type: String, required: true, unique: true, index: true, minlength: 6, maxlength: 6 },
    formId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
    dealId: { type: Schema.Types.ObjectId, ref: "Deal", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    status: { type: String, enum: ["pending", "submitted"], default: "pending" },
    responseId: { type: Schema.Types.ObjectId, ref: "FormResponse" },
    sentAt: { type: Date, required: true, default: Date.now },
    submittedAt: { type: Date },
  },
  { timestamps: true },
);

FormInviteSchema.index({ dealId: 1, createdAt: -1 });
FormInviteSchema.index({ dealId: 1, formId: 1 }, { unique: true });

const FormInvite: Model<IFormInvite> =
  models.FormInvite || model<IFormInvite>("FormInvite", FormInviteSchema);

export default FormInvite;
