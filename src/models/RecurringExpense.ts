import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IRecurringExpense extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  description: string;
  category: string;
  value: number;
  day: number;
  payment: string;
  startMonth: string; // YYYY-MM
  skippedMonths: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringExpenseSchema = new Schema<IRecurringExpense>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "Outros" },
    value: { type: Number, required: true, min: 0 },
    day: { type: Number, min: 1, max: 31, default: 1 },
    payment: { type: String, default: "Pix" },
    startMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    skippedMonths: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const RecurringExpense: Model<IRecurringExpense> =
  models.RecurringExpense || model<IRecurringExpense>("RecurringExpense", RecurringExpenseSchema);

export default RecurringExpense;
