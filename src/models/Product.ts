import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  operationalCost: number;
  profit: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    operationalCost: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

ProductSchema.plugin(tenantPlugin);

const Product: Model<IProduct> =
  models.Product || model<IProduct>("Product", ProductSchema);

export default Product;
