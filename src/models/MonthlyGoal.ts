import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface IMonthlyGoal extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  month: string; // YYYY-MM
  /** Caixa da meta ("" = visão de todos os caixas). */
  cashbox: string;
  value: number;
}

const MonthlyGoalSchema = new Schema<IMonthlyGoal>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    cashbox: { type: String, trim: true, default: "" },
    value: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

MonthlyGoalSchema.index({ ownerId: 1, month: 1, cashbox: 1 }, { unique: true });

MonthlyGoalSchema.plugin(tenantPlugin);

const MonthlyGoal: Model<IMonthlyGoal> =
  models.MonthlyGoal || model<IMonthlyGoal>("MonthlyGoal", MonthlyGoalSchema);

export default MonthlyGoal;
