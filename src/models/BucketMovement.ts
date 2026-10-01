import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/**
 * Movimento de uma caixa de distribuição: entrada (parte de uma distribuição)
 * ou saída (retirada/uso do saldo). As entradas de uma mesma distribuição
 * compartilham o `groupId`.
 */
export interface IBucketMovement extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  kind: "in" | "out";
  bucketId: Types.ObjectId;
  /** Nome copiado: o histórico continua legível se a caixa for renomeada ou apagada. */
  bucketName: string;
  value: number;
  /** Porcentagem usada na distribuição (só nas entradas). */
  percentage?: number;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  groupId?: Types.ObjectId;
  /** Entrada do financeiro que originou a distribuição. */
  entryId?: Types.ObjectId;
  cashbox: string;
  createdAt: Date;
  updatedAt: Date;
}

const BucketMovementSchema = new Schema<IBucketMovement>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["in", "out"], required: true },
    bucketId: { type: Schema.Types.ObjectId, ref: "DistributionBucket", required: true },
    bucketName: { type: String, trim: true, default: "" },
    value: { type: Number, required: true, min: 0 },
    percentage: { type: Number, min: 0, max: 100 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    description: { type: String, trim: true, default: "" },
    groupId: { type: Schema.Types.ObjectId },
    entryId: { type: Schema.Types.ObjectId, ref: "FinanceEntry" },
    cashbox: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

BucketMovementSchema.index({ ownerId: 1, date: -1 });
BucketMovementSchema.index({ groupId: 1 });
BucketMovementSchema.index({ entryId: 1 });

BucketMovementSchema.plugin(tenantPlugin);

const BucketMovement: Model<IBucketMovement> =
  models.BucketMovement || model<IBucketMovement>("BucketMovement", BucketMovementSchema);

export default BucketMovement;
