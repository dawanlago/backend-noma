import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface ICompany extends Document {
  _id: Types.ObjectId;
  name: string;
  /** CNPJ (ou CPF, para pessoa física). */
  taxId: string;
  /** Logomarca reduzida no navegador (data URL). */
  logo: string;
  niche: string;
  email: string;
  phone: string;
  instagram: string;
  website: string;
  affinity: number;
  kinds: string[];
  supplierCategory: string;
  /** Chave PIX para pagar o fornecedor/parceiro. */
  pixKey: string;
  notes: string;
  custom: Record<string, unknown>;
  isActive: boolean;
  /** Legado: o vínculo oficial é Contact.companyId. */
  contactIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true },
    taxId: { type: String, trim: true, default: "" },
    logo: { type: String, default: "" },
    niche: { type: String, trim: true, default: "" },
    email: { type: String, lowercase: true, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    instagram: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    affinity: { type: Number, min: 0, max: 5, default: 0 },
    kinds: { type: [String], default: [] },
    supplierCategory: { type: String, trim: true, default: "" },
    pixKey: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    custom: { type: Schema.Types.Mixed, default: {} },
    isActive: { type: Boolean, default: true },
    contactIds: [{ type: Schema.Types.ObjectId, ref: "Contact" }],
  },
  { timestamps: true, minimize: false },
);

CompanySchema.index({ kinds: 1 });

const Company: Model<ICompany> =
  models.Company || model<ICompany>("Company", CompanySchema);

export default Company;
