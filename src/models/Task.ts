import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Item do checklist de atividades (pode estar ligado a uma negociação). */
export interface ITask extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  /** YYYY-MM-DD (opcional). */
  dueDate: string;
  done: boolean;
  doneAt?: Date;
  leadId?: Types.ObjectId;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    dueDate: { type: String, trim: true, default: "", match: /^(\d{4}-\d{2}-\d{2})?$/ },
    done: { type: Boolean, default: false },
    doneAt: { type: Date },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

TaskSchema.pre("save", function syncDoneAt() {
  if (this.isModified("done")) this.doneAt = this.done ? new Date() : undefined;
});

TaskSchema.index({ ownerId: 1, done: 1, dueDate: 1 });
TaskSchema.index({ leadId: 1 });

const Task: Model<ITask> = models.Task || model<ITask>("Task", TaskSchema);

export default Task;
