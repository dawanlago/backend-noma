import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface IProductCost {
  label: string;
  value: number;
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  /** Categoria (lista "productCategory"); cada uma tem seu modelo de linhas de custo. */
  category: string;
  /** Linhas de custo; a soma fica em `operationalCost`. */
  costs: IProductCost[];
  operationalCost: number;
  profit: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductCostSchema = new Schema<IProductCost>(
  {
    label: { type: String, trim: true, required: true },
    value: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "" },
    costs: { type: [ProductCostSchema], default: [] },
    operationalCost: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

ProductSchema.plugin(tenantPlugin);

const Product: Model<IProduct> =
  models.Product || model<IProduct>("Product", ProductSchema);

export default Product;
