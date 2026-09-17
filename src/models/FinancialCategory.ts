import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IFinancialCategory extends Document {
  _id: Types.ObjectId;
  name: string;
  percentage: number;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FinancialCategorySchema = new Schema<IFinancialCategory>(
  {
    name: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    order: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

FinancialCategorySchema.index({ isActive: 1, order: 1 });

const FinancialCategory: Model<IFinancialCategory> =
  models.FinancialCategory || model<IFinancialCategory>("FinancialCategory", FinancialCategorySchema);

export default FinancialCategory;
