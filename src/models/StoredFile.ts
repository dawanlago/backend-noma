import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Arquivo enviado (ex.: contrato importado). O conteúdo fica no Cloudinary. */
export interface IStoredFile extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  category: string;
  title: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  publicId: string;
  resourceType: "image" | "raw";
  contactId?: Types.ObjectId;
  companyId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true, trim: true },
    title: { type: String, trim: true, default: "" },
    name: { type: String, required: true, trim: true },
    mimeType: { type: String, trim: true, default: "application/octet-stream" },
    size: { type: Number, min: 0, default: 0 },
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    resourceType: { type: String, enum: ["image", "raw"], default: "raw" },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

StoredFileSchema.index({ ownerId: 1, category: 1, createdAt: -1 });

const StoredFile: Model<IStoredFile> = models.StoredFile || model<IStoredFile>("StoredFile", StoredFileSchema);

export default StoredFile;
