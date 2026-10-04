import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Empresa do grupo (Noma, Brava...). Cada uma tem seus próprios dados, funis e financeiro. */
export interface IOrganization extends Document {
  _id: Types.ObjectId;
  name: string;
  logo: string;
  color: string;
  isActive: boolean;
  /** A primeira empresa (dona dos dados de antes da separação). Só uma pode ter. */
  isPrimary: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    logo: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "", match: /^(#[0-9a-fA-F]{6})?$/ },
    isActive: { type: Boolean, default: true },
    isPrimary: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Garante uma só "primeira empresa" mesmo com dois servidores subindo ao mesmo tempo.
OrganizationSchema.index({ isPrimary: 1 }, { unique: true, partialFilterExpression: { isPrimary: true } });

const Organization: Model<IOrganization> = models.Organization || model<IOrganization>("Organization", OrganizationSchema);

export default Organization;
