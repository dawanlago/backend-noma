import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IContact extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  companyId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  },
  { timestamps: true },
);

ContactSchema.index({ email: 1 });
ContactSchema.index({ companyId: 1 });

const Contact: Model<IContact> =
  models.Contact || model<IContact>("Contact", ContactSchema);

export default Contact;
