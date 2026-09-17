import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { TransactionType } from "../types";

export interface IProductCalculation {
  operational: number;
  marketing10: number;
  tax8: number;
  equipment7: number;
  cash5: number;
  profit25: number;
}

export interface ITransactionDistribution {
  categoryId?: Types.ObjectId;
  categoryName: string;
  percentage: number;
  value: number;
}

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  type: TransactionType;
  dealId?: Types.ObjectId;
  value: number;
  description?: string;
  category?: string;
  productCalculation?: IProductCalculation;
  distribution: ITransactionDistribution[];
  date: Date;
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductCalculationSchema = new Schema<IProductCalculation>(
  {
    operational: { type: Number, required: true, default: 0 },
    marketing10: { type: Number, required: true, default: 0 },
    tax8: { type: Number, required: true, default: 0 },
    equipment7: { type: Number, required: true, default: 0 },
    cash5: { type: Number, required: true, default: 0 },
    profit25: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const TransactionDistributionSchema = new Schema<ITransactionDistribution>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "FinancialCategory" },
    categoryName: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const TransactionSchema = new Schema<ITransaction>(
  {
    type: { type: String, enum: ["income", "expense"], required: true },
    dealId: { type: Schema.Types.ObjectId, ref: "Deal" },
    value: { type: Number, required: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true },
    productCalculation: { type: ProductCalculationSchema },
    distribution: { type: [TransactionDistributionSchema], default: [] },
    date: { type: Date, required: true, default: Date.now },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

TransactionSchema.index({ date: -1 });
TransactionSchema.index({ dealId: 1 });
TransactionSchema.index({ type: 1, date: -1 });

const Transaction: Model<ITransaction> =
  models.Transaction || model<ITransaction>("Transaction", TransactionSchema);

export default Transaction;
