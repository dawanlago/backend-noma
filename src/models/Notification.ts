import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/** Aviso para um usuário (sino no topo). */
export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** lead_created, form_response, proposal_viewed, proposal_accepted, booking, note_shared, task_reminder, task_overdue... */
  type: string;
  title: string;
  body: string;
  /** Rota do sistema para abrir (ex.: /crm/<id>). */
  link: string;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, trim: true, required: true },
    title: { type: String, trim: true, required: true },
    body: { type: String, trim: true, default: "" },
    link: { type: String, trim: true, default: "" },
    readAt: { type: Date },
  },
  { timestamps: true },
);

NotificationSchema.plugin(tenantPlugin);
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
// Avisos com mais de 90 dias somem sozinhos.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

const Notification: Model<INotification> = models.Notification || model<INotification>("Notification", NotificationSchema);

export default Notification;
