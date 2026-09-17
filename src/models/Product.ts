import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  operationalCost: number;
  profit: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    operationalCost: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

const Product: Model<IProduct> =
  models.Product || model<IProduct>("Product", ProductSchema);

export default Product;
