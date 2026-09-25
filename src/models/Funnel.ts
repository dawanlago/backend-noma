import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { StageKind } from "../types";

export interface IFunnelStage {
  _id: Types.ObjectId;
  name: string;
  /** open = em andamento; won = venda feita; lost = perdida. */
  kind: StageKind;
  color: string;
  /** Chave da etapa antiga (só no funil padrão migrado). */
  key?: string;
}

export interface IFunnel extends Document {
  _id: Types.ObjectId;
  name: string;
  order: number;
  stages: Types.DocumentArray<IFunnelStage & Types.Subdocument>;
  createdAt: Date;
  updatedAt: Date;
}

const FunnelStageSchema = new Schema<IFunnelStage>({
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ["open", "won", "lost"], default: "open" },
  color: { type: String, trim: true, default: "" },
  key: { type: String, trim: true },
});

const FunnelSchema = new Schema<IFunnel>(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    stages: { type: [FunnelStageSchema], default: [] },
  },
  { timestamps: true },
);

const Funnel: Model<IFunnel> = models.Funnel || model<IFunnel>("Funnel", FunnelSchema);

export default Funnel;
