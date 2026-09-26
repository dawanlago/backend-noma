import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { FORM_FIELD_TARGETS, FORM_FIELD_TYPES, type FormFieldTarget, type FormFieldType } from "../types";

export interface IFormField {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  placeholder: string;
  /** Dado do contato que esta resposta preenche. */
  target: FormFieldTarget;
}

/** Formulário com link público; as respostas podem virar contato + negociação. */
export interface IForm extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description: string;
  publicId: string;
  isActive: boolean;
  fields: IFormField[];
  successMessage: string;
  /** Aparência própria do link (vazio = identidade de Configurações → Geral). */
  logo: string;
  accentColor: string;
  createLead: boolean;
  funnelId?: Types.ObjectId;
  stageId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FormFieldSchema = new Schema<IFormField>(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: FORM_FIELD_TYPES, default: "text" },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] },
    placeholder: { type: String, trim: true, default: "" },
    target: { type: String, enum: FORM_FIELD_TARGETS, default: "" },
  },
  { _id: false },
);

const FormSchema = new Schema<IForm>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    publicId: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
    fields: { type: [FormFieldSchema], default: [] },
    successMessage: { type: String, trim: true, default: "Recebemos suas respostas. Obrigado!" },
    logo: { type: String, trim: true, default: "" },
    accentColor: { type: String, trim: true, default: "", match: /^(#[0-9a-fA-F]{6})?$/ },
    createLead: { type: Boolean, default: true },
    funnelId: { type: Schema.Types.ObjectId, ref: "Funnel" },
    stageId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

const Form: Model<IForm> = models.Form || model<IForm>("Form", FormSchema);

export default Form;
