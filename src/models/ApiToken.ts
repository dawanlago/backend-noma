import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/**
 * Token da API de automação (sistemas externos mandando leads). O token em si só aparece uma vez,
 * ao ser criado: aqui fica o hash (sha256) para conferir e o começo dele para reconhecer na lista.
 */
export interface IApiToken extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  name: string;
  /** Começo do token (ex.: "noma_live_Ab3x"), só para exibir. */
  prefix: string;
  hash: string;
  createdBy?: Types.ObjectId;
  createdByName: string;
  lastUsedAt?: Date;
  /** Preenchido = revogado (não autentica mais). */
  revokedAt?: Date;
  revokedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ApiTokenSchema = new Schema<IApiToken>(
  {
    name: { type: String, required: true, trim: true },
    prefix: { type: String, required: true },
    hash: { type: String, required: true, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true, default: "" },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
    revokedByName: { type: String, trim: true },
  },
  { timestamps: true },
);

ApiTokenSchema.plugin(tenantPlugin);
ApiTokenSchema.index({ hash: 1 }, { unique: true });

const ApiToken: Model<IApiToken> = models.ApiToken || model<IApiToken>("ApiToken", ApiTokenSchema);

export default ApiToken;
