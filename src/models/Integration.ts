import crypto from "crypto";
import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export type IntegrationProvider = "zapi" | "assinafy" | "anthropic" | "automation";

/**
 * Integração de uma empresa com um serviço externo (Z-API, Assinafy, IA, API de automação).
 * `config` guarda o que pode ser mostrado na tela; `secrets` guarda chaves e tokens criptografados
 * (lib/secretBox), que nunca voltam para o navegador.
 */
export interface IIntegration extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  provider: IntegrationProvider;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  /** Identificador aleatório usado nas URLs de webhook (descobre a empresa sem login). */
  hookKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationSchema = new Schema<IIntegration>(
  {
    provider: { type: String, enum: ["zapi", "assinafy", "anthropic", "automation"], required: true },
    enabled: { type: Boolean, default: true },
    config: { type: Schema.Types.Mixed, default: {} },
    secrets: { type: Schema.Types.Mixed, default: {} },
    hookKey: { type: String, default: () => crypto.randomBytes(18).toString("base64url") },
  },
  { timestamps: true, minimize: false },
);

IntegrationSchema.plugin(tenantPlugin);
IntegrationSchema.index({ orgId: 1, provider: 1 }, { unique: true });
IntegrationSchema.index({ hookKey: 1 }, { unique: true });

const Integration: Model<IIntegration> = models.Integration || model<IIntegration>("Integration", IntegrationSchema);

export default Integration;
