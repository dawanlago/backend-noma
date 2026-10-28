import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/**
 * Envio de um contrato para assinatura eletrônica na Assinafy.
 * processing: PDF enviado, aguardando a Assinafy processar para disparar os convites;
 * pending: convites enviados; finishing: todos assinaram, gerando o PDF certificado;
 * signed: PDF assinado disponível; rejected/expired/failed/cancelled: encerrado sem assinatura.
 */
export type SignatureStatus = "processing" | "pending" | "finishing" | "signed" | "rejected" | "expired" | "failed" | "cancelled";
export type SignerStatus = "pending" | "signed" | "rejected";

export interface IContractSigner {
  assinafyId: string;
  name: string;
  email: string;
  governmentId: string;
  role: string;
  status: SignerStatus;
  signingUrl: string;
  viewedAt?: Date;
  signedAt?: Date;
  rejectedAt?: Date;
}

export interface IContractSignature extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  documentId: Types.ObjectId;
  ownerId: Types.ObjectId;
  createdBy: Types.ObjectId;
  environment: "production" | "sandbox";
  assinafyDocumentId: string;
  assinafyAssignmentId: string;
  assinafyStatus: string;
  status: SignatureStatus;
  message: string;
  signers: IContractSigner[];
  lastError: string;
  sentAt?: Date;
  completedAt?: Date;
  /** Quando o dono foi avisado da conclusão (evita aviso duplicado entre webhook e atualização manual). */
  notifiedAt?: Date;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SignerSchema = new Schema<IContractSigner>(
  {
    assinafyId: { type: String, default: "" },
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, required: true },
    governmentId: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["pending", "signed", "rejected"], default: "pending" },
    signingUrl: { type: String, default: "" },
    viewedAt: Date,
    signedAt: Date,
    rejectedAt: Date,
  },
  { _id: false },
);

const ContractSignatureSchema = new Schema<IContractSignature>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: "ToolDocument", required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    environment: { type: String, enum: ["production", "sandbox"], default: "production" },
    assinafyDocumentId: { type: String, required: true },
    assinafyAssignmentId: { type: String, default: "" },
    assinafyStatus: { type: String, default: "" },
    status: {
      type: String,
      enum: ["processing", "pending", "finishing", "signed", "rejected", "expired", "failed", "cancelled"],
      default: "processing",
    },
    message: { type: String, default: "" },
    signers: { type: [SignerSchema], default: [] },
    lastError: { type: String, default: "" },
    sentAt: Date,
    completedAt: Date,
    notifiedAt: Date,
    lastSyncedAt: Date,
  },
  { timestamps: true },
);

ContractSignatureSchema.plugin(tenantPlugin);
ContractSignatureSchema.index({ documentId: 1, createdAt: -1 });
ContractSignatureSchema.index({ assinafyDocumentId: 1 });

const ContractSignature: Model<IContractSignature> =
  models.ContractSignature || model<IContractSignature>("ContractSignature", ContractSignatureSchema);

export default ContractSignature;
