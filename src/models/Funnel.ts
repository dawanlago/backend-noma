import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { StageType } from "../types";

export interface IFunnelStage {
  _id: Types.ObjectId;
  name: string;
  order: number;
  type: StageType;
}

export interface IFunnel extends Document {
  _id: Types.ObjectId;
  name: string;
  stages: IFunnelStage[];
  createdAt: Date;
  updatedAt: Date;
}

const FunnelStageSchema = new Schema<IFunnelStage>(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, required: true },
    type: {
      type: String,
      enum: ["agenda", "closure", "general"],
      default: "general",
    },
  },
  { _id: true },
);

const FunnelSchema = new Schema<IFunnel>(
  {
    name: { type: String, required: true, trim: true },
    stages: { type: [FunnelStageSchema], default: [] },
  },
  { timestamps: true },
);

const Funnel: Model<IFunnel> =
  models.Funnel || model<IFunnel>("Funnel", FunnelSchema);

export default Funnel;
