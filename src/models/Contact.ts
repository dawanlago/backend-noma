import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface IContact extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  cpf: string;
  /** YYYY-MM-DD */
  birthDate: string;
  /** Foto reduzida no navegador (data URL). */
  photo: string;
  niche: string;
  jobRole: string;
  instagram: string;
  companyId?: Types.ObjectId;
  /** Estrelas de afinidade, de 0 a 5. */
  affinity: number;
  /** Tipos de relação na base: client, lead, supplier, partner... */
  kinds: string[];
  supplierCategory: string;
  /** Chave PIX para pagar o fornecedor/parceiro. */
  pixKey: string;
  notes: string;
  custom: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    cpf: { type: String, trim: true, default: "" },
    birthDate: { type: String, trim: true, default: "" },
    photo: { type: String, default: "" },
    niche: { type: String, trim: true, default: "" },
    jobRole: { type: String, trim: true, default: "" },
    instagram: { type: String, trim: true, default: "" },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    affinity: { type: Number, min: 0, max: 5, default: 0 },
    kinds: { type: [String], default: [] },
    supplierCategory: { type: String, trim: true, default: "" },
    pixKey: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    custom: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

ContactSchema.index({ email: 1 });
ContactSchema.index({ companyId: 1 });
ContactSchema.index({ kinds: 1 });

ContactSchema.plugin(tenantPlugin);

const Contact: Model<IContact> =
  models.Contact || model<IContact>("Contact", ContactSchema);

export default Contact;
