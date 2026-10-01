import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/** Link público de uma proposta salva (um por documento), enviado ao cliente. */
export interface IProposalLink extends Document {
  _id: Types.ObjectId;
  token: string;
  documentId: Types.ObjectId;
  ownerId: Types.ObjectId;
  isActive: boolean;
  /** Resumo das visualizações, para a listagem não precisar agregar as sessões. */
  viewsCount: number;
  firstViewedAt?: Date;
  lastViewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProposalLinkSchema = new Schema<IProposalLink>(
  {
    token: { type: String, required: true, unique: true },
    documentId: { type: Schema.Types.ObjectId, ref: "ToolDocument", required: true, unique: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
    viewsCount: { type: Number, default: 0 },
    firstViewedAt: { type: Date },
    lastViewedAt: { type: Date },
  },
  { timestamps: true },
);

ProposalLinkSchema.plugin(tenantPlugin);

const ProposalLink: Model<IProposalLink> =
  models.ProposalLink || model<IProposalLink>("ProposalLink", ProposalLinkSchema);

export default ProposalLink;
