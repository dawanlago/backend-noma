import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/**
 * Caixa de distribuição (ex.: Operacional, Imposto, Lucro): recebe uma
 * porcentagem de cada valor distribuído e guarda um saldo próprio.
 */
export interface IDistributionBucket extends Document {
  _id: Types.ObjectId;
  name: string;
  percentage: number;
  color: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const DistributionBucketSchema = new Schema<IDistributionBucket>(
  {
    name: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    color: { type: String, trim: true, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const DistributionBucket: Model<IDistributionBucket> =
  models.DistributionBucket || model<IDistributionBucket>("DistributionBucket", DistributionBucketSchema);

export default DistributionBucket;
