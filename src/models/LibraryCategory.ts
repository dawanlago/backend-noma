import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface ILibraryCategory extends Document {
  _id: Types.ObjectId;
  key: string;
  title: string;
  description: string;
  url: string;
  order: number;
}

const LibraryCategorySchema = new Schema<ILibraryCategory>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    url: { type: String, trim: true, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const LibraryCategory: Model<ILibraryCategory> =
  models.LibraryCategory || model<ILibraryCategory>("LibraryCategory", LibraryCategorySchema);

export default LibraryCategory;
