import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { PAYMENT_METHODS, type FinanceStatus, type TransactionType } from "../types";

export interface IFinanceEntry extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  type: TransactionType;
  description: string;
  client: string;
  category: string;
  value: number;
  date: string; // YYYY-MM-DD, sem fuso horário
  status: FinanceStatus;
  payment: string;
  recurringId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FinanceEntrySchema = new Schema<IFinanceEntry>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["income", "expense"], required: true },
    description: { type: String, required: true, trim: true },
    client: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "Outro" },
    value: { type: Number, required: true, min: 0 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ["received", "pending", "paid", "planned"], required: true },
    payment: { type: String, enum: PAYMENT_METHODS, default: "Pix" },
    recurringId: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
  },
  { timestamps: true },
);

FinanceEntrySchema.index({ ownerId: 1, date: 1 });
FinanceEntrySchema.index({ recurringId: 1, date: 1 });

const FinanceEntry: Model<IFinanceEntry> =
  models.FinanceEntry || model<IFinanceEntry>("FinanceEntry", FinanceEntrySchema);

export default FinanceEntry;
