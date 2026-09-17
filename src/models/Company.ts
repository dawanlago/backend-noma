import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface ICompany extends Document {
  _id: Types.ObjectId;
  name: string;
  taxId: string;
  isActive: boolean;
  contactIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true },
    taxId: { type: String, required: true, trim: true, unique: true },
    isActive: { type: Boolean, default: false },
    contactIds: [{ type: Schema.Types.ObjectId, ref: "Contact" }],
  },
  { timestamps: true },
);

const Company: Model<ICompany> =
  models.Company || model<ICompany>("Company", CompanySchema);

export default Company;
