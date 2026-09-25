import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IMonthlyGoal extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  month: string; // YYYY-MM
  value: number;
}

const MonthlyGoalSchema = new Schema<IMonthlyGoal>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    value: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

MonthlyGoalSchema.index({ ownerId: 1, month: 1 }, { unique: true });

const MonthlyGoal: Model<IMonthlyGoal> =
  models.MonthlyGoal || model<IMonthlyGoal>("MonthlyGoal", MonthlyGoalSchema);

export default MonthlyGoal;
