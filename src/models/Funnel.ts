import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";
import type { StageKind } from "../types";

/** Microetapa: subdivisão de uma etapa (ex.: "Proposta enviada" → "Aguardando retorno", "Em ajuste"). */
export interface IFunnelSubStage {
  _id: Types.ObjectId;
  name: string;
}

export interface IFunnelStage {
  _id: Types.ObjectId;
  name: string;
  /** open = em andamento; won = venda feita; lost = perdida. */
  kind: StageKind;
  color: string;
  /** Chave da etapa antiga (só no funil padrão migrado). */
  key?: string;
  subStages: Types.DocumentArray<IFunnelSubStage & Types.Subdocument>;
}

export interface IFunnel extends Document {
  _id: Types.ObjectId;
  name: string;
  order: number;
  stages: Types.DocumentArray<IFunnelStage & Types.Subdocument>;
  createdAt: Date;
  updatedAt: Date;
}

const FunnelSubStageSchema = new Schema<IFunnelSubStage>({
  name: { type: String, required: true, trim: true },
});

const FunnelStageSchema = new Schema<IFunnelStage>({
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ["open", "won", "lost"], default: "open" },
  color: { type: String, trim: true, default: "" },
  key: { type: String, trim: true },
  subStages: { type: [FunnelSubStageSchema], default: [] },
});

const FunnelSchema = new Schema<IFunnel>(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    stages: { type: [FunnelStageSchema], default: [] },
  },
  { timestamps: true },
);

FunnelSchema.plugin(tenantPlugin);

const Funnel: Model<IFunnel> = models.Funnel || model<IFunnel>("Funnel", FunnelSchema);

export default Funnel;
