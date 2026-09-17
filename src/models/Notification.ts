import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { NotificationType } from "../types";

export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  dealId?: Types.ObjectId;
  taskId?: Types.ObjectId;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: [
        "deal_assigned",
        "owner_changed",
        "task_created",
        "deal_stage_changed",
        "form_submitted",
        "finance_reverted",
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    dealId: { type: Schema.Types.ObjectId, ref: "Deal" },
    taskId: { type: Schema.Types.ObjectId, ref: "Task" },
    readAt: { type: Date },
  },
  { timestamps: true },
);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });

const Notification: Model<INotification> =
  models.Notification || model<INotification>("Notification", NotificationSchema);

export default Notification;
