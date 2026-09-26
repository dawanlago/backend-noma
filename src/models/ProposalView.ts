import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Sessão de visualização do link público de uma proposta (uma por aba aberta). */
export interface IProposalView extends Document {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  linkId: Types.ObjectId;
  /** Segredo da sessão: só quem abriu a página consegue enviar os heartbeats. */
  key: string;
  openedAt: Date;
  lastSeenAt: Date;
  /** Tempo com a aba visível, em segundos. */
  durationSeconds: number;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  os: string;
  browser: string;
  userAgent: string;
}

const ProposalViewSchema = new Schema<IProposalView>({
  documentId: { type: Schema.Types.ObjectId, ref: "ToolDocument", required: true },
  linkId: { type: Schema.Types.ObjectId, ref: "ProposalLink", required: true },
  key: { type: String, required: true },
  openedAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  durationSeconds: { type: Number, default: 0 },
  device: { type: String, enum: ["mobile", "tablet", "desktop", "unknown"], default: "unknown" },
  os: { type: String, default: "" },
  browser: { type: String, default: "" },
  userAgent: { type: String, default: "" },
});

ProposalViewSchema.index({ documentId: 1, openedAt: -1 });
ProposalViewSchema.index({ linkId: 1, openedAt: -1 });

const ProposalView: Model<IProposalView> =
  models.ProposalView || model<IProposalView>("ProposalView", ProposalViewSchema);

export default ProposalView;
