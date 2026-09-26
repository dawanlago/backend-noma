import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/**
 * Formulário enviado dentro de uma negociação: link com código de 6 dígitos,
 * preenchido uma única vez; as respostas ficam na negociação.
 */
export interface IFormInvite extends Document {
  _id: Types.ObjectId;
  code: string;
  formId: Types.ObjectId;
  leadId: Types.ObjectId;
  contactId?: Types.ObjectId;
  ownerId: Types.ObjectId;
  status: "pending" | "submitted";
  responseId?: Types.ObjectId;
  sentAt: Date;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FormInviteSchema = new Schema<IFormInvite>(
  {
    code: { type: String, required: true, unique: true, match: /^\d{6}$/ },
    formId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "submitted"], default: "pending" },
    responseId: { type: Schema.Types.ObjectId, ref: "FormResponse" },
    sentAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
  },
  { timestamps: true },
);

FormInviteSchema.index({ leadId: 1, formId: 1 }, { unique: true });

const FormInvite: Model<IFormInvite> = models.FormInvite || model<IFormInvite>("FormInvite", FormInviteSchema);

export default FormInvite;
