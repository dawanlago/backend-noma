import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export type TaskStatus = "todo" | "doing" | "done";

/**
 * Atividade/compromisso: aparece no checklist e, com data, na Agenda.
 * Pode estar ligado a uma negociação.
 */
export interface ITask extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  /** Tipo (lista de opções `taskType`: reunião, ligação, e-mail, follow-up ou personalizado). */
  type: string;
  /** YYYY-MM-DD (opcional). */
  dueDate: string;
  /** HH:MM (opcional; compromissos da agenda). */
  time: string;
  status: TaskStatus;
  done: boolean;
  doneAt?: Date;
  leadId?: Types.ObjectId;
  notes: string;
  /** Duração em minutos (compromissos com hora). */
  duration: number;
  /** Evento correspondente no Google Agenda do responsável. */
  googleEventId: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, trim: true, default: "" },
    dueDate: { type: String, trim: true, default: "", match: /^(\d{4}-\d{2}-\d{2})?$/ },
    time: { type: String, trim: true, default: "", match: /^(\d{2}:\d{2})?$/ },
    status: { type: String, enum: ["todo", "doing", "done"], default: "todo" },
    done: { type: Boolean, default: false },
    doneAt: { type: Date },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    notes: { type: String, default: "" },
    duration: { type: Number, default: 60, min: 5, max: 1440 },
    googleEventId: { type: String, default: "" },
  },
  { timestamps: true },
);

TaskSchema.pre("save", function syncStatus() {
  // `status` e `done` andam juntos: marcar como feito no checklist conclui o compromisso e vice-versa.
  if (this.isModified("status")) this.done = this.status === "done";
  else if (this.isModified("done")) this.status = this.done ? "done" : this.status === "done" ? "todo" : this.status;
  if (this.isModified("done")) this.doneAt = this.done ? new Date() : undefined;
});

TaskSchema.index({ ownerId: 1, done: 1, dueDate: 1 });
TaskSchema.index({ leadId: 1 });

const Task: Model<ITask> = models.Task || model<ITask>("Task", TaskSchema);

export default Task;
