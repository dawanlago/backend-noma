import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { phoneKey } from "../lib/phone";
import { tenantPlugin } from "../lib/tenant";

export interface IContact extends Document {
  _id: Types.ObjectId;
  /** Nome de exibição (como o contato aparece no sistema). */
  name: string;
  fullName: string;
  nickname: string;
  email: string;
  phone: string;
  /** Telefone normalizado (lib/phone), para achar duplicados. Calculado ao salvar. */
  phoneKey: string;
  cpf: string;
  /** YYYY-MM-DD */
  birthDate: string;
  /** Foto reduzida no navegador (data URL). */
  photo: string;
  niche: string;
  jobRole: string;
  instagram: string;
  /** Cidade/UF. */
  location: string;
  /** Origem do lead (lista de opções `leadSource`). */
  leadSource: string;
  /** Empresa principal: sempre a primeira de `companyIds` (mantida para o código que lê uma só). */
  companyId?: Types.ObjectId;
  /** Todas as empresas a que o contato está vinculado. */
  companyIds: Types.ObjectId[];
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
    fullName: { type: String, trim: true, default: "" },
    nickname: { type: String, trim: true, default: "" },
    email: { type: String, lowercase: true, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    phoneKey: { type: String, default: "" },
    cpf: { type: String, trim: true, default: "" },
    birthDate: { type: String, trim: true, default: "" },
    photo: { type: String, default: "" },
    niche: { type: String, trim: true, default: "" },
    jobRole: { type: String, trim: true, default: "" },
    instagram: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    leadSource: { type: String, trim: true, default: "" },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    companyIds: { type: [{ type: Schema.Types.ObjectId, ref: "Company" }], default: [] },
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
ContactSchema.index({ companyIds: 1 });
ContactSchema.index({ orgId: 1, phoneKey: 1 });
ContactSchema.index({ kinds: 1 });

/** Mantém `phoneKey` e a empresa principal coerentes, venha o contato de onde vier (tela, formulário, extensão). */
ContactSchema.pre("save", function syncDerived() {
  if (this.isNew || this.isModified("phone")) this.phoneKey = phoneKey(this.phone);
  const listChanged = this.isModified("companyIds");
  if (!listChanged && !this.isModified("companyId")) return;
  let ids = [...new Set((this.companyIds || []).map(String))];
  // Só a principal mudou (código antigo): ela vai para a frente da lista; sem ela, o contato fica sem empresa.
  if (!listChanged || (this.isNew && !ids.length)) {
    ids = this.companyId ? [String(this.companyId), ...ids.filter((id) => id !== String(this.companyId))] : [];
  }
  this.set("companyIds", ids);
  this.set("companyId", ids[0] || undefined);
});

ContactSchema.plugin(tenantPlugin);

const Contact: Model<IContact> =
  models.Contact || model<IContact>("Contact", ContactSchema);

export default Contact;
