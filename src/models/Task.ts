import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { TaskStatus } from "../types";

export interface ITask extends Document {
  _id: Types.ObjectId;
  dealId?: Types.ObjectId;
  title: string;
  description?: string;
  dueDate: Date;
  status: TaskStatus;
  isCompleted: boolean;
  googleEventId?: string;
  googleSyncedAt?: Date;
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    dealId: { type: Schema.Types.ObjectId, ref: "Deal" },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["todo", "doing", "done"],
      default: "todo",
    },
    isCompleted: { type: Boolean, default: false },
    googleEventId: { type: String, trim: true },
    googleSyncedAt: { type: Date },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

TaskSchema.pre("save", function syncCompletedFlag() {
  this.isCompleted = this.status === "done";
});

TaskSchema.index({ dealId: 1, status: 1 });
TaskSchema.index({ userId: 1, dueDate: 1 });
TaskSchema.index({ dueDate: -1 });

const Task: Model<ITask> = models.Task || model<ITask>("Task", TaskSchema);

export default Task;
