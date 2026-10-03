import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export const PROPOSAL_EVENT_TYPES = [
  "link_created",
  "link_enabled",
  "link_disabled",
  "link_regenerated",
  "viewed",
  "accepted",
] as const;
export type ProposalEventType = (typeof PROPOSAL_EVENT_TYPES)[number];

/** Histórico do link público de uma proposta: ações da equipe e do cliente. */
export interface IProposalEvent extends Document {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  linkId?: Types.ObjectId;
  type: ProposalEventType;
  at: Date;
  /** Quem fez: usuário da equipe ou o nome informado pelo cliente ao aceitar. */
  actorName: string;
  comment: string;
  device: "mobile" | "tablet" | "desktop" | "unknown" | "";
  os: string;
  browser: string;
}

const ProposalEventSchema = new Schema<IProposalEvent>({
  documentId: { type: Schema.Types.ObjectId, ref: "ToolDocument", required: true },
  linkId: { type: Schema.Types.ObjectId, ref: "ProposalLink" },
  type: { type: String, enum: PROPOSAL_EVENT_TYPES, required: true },
  at: { type: Date, default: Date.now },
  actorName: { type: String, default: "" },
  comment: { type: String, default: "" },
  device: { type: String, enum: ["mobile", "tablet", "desktop", "unknown", ""], default: "" },
  os: { type: String, default: "" },
  browser: { type: String, default: "" },
});

ProposalEventSchema.index({ documentId: 1, at: -1 });

ProposalEventSchema.plugin(tenantPlugin);

const ProposalEvent: Model<IProposalEvent> =
  models.ProposalEvent || model<IProposalEvent>("ProposalEvent", ProposalEventSchema);

export default ProposalEvent;
