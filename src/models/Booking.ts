import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/** Reunião marcada pelo lead no link de agendamento. */
export interface IBooking extends Document {
  _id: Types.ObjectId;
  linkId: Types.ObjectId;
  ownerId: Types.ObjectId;
  start: Date;
  end: Date;
  name: string;
  email: string;
  phone: string;
  notes: string;
  status: "confirmed" | "cancelled";
  taskId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "SchedulingLink", required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
    taskId: { type: Schema.Types.ObjectId, ref: "Task" },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
  },
  { timestamps: true },
);

BookingSchema.plugin(tenantPlugin);
// Trava contra dois leads no mesmo horário: vale para a pessoa em todas as empresas (por isso sem orgId).
BookingSchema.index({ ownerId: 1, start: 1 }, { unique: true, partialFilterExpression: { status: "confirmed" } });

const Booking: Model<IBooking> = models.Booking || model<IBooking>("Booking", BookingSchema);

export default Booking;
