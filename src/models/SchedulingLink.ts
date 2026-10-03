import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";
import type { WeeklyWindow } from "../lib/availability";

export interface ISchedulingBlock {
  start: Date;
  end: Date;
  note: string;
}

/**
 * Link de agendamento externo: o lead abre /agendar/<slug> e escolhe um horário livre
 * na agenda do responsável (janelas da semana − compromissos − Google Agenda − bloqueios).
 */
export interface ISchedulingLink extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  slug: string;
  title: string;
  description: string;
  /** Local ou link da reunião (Meet, endereço...). */
  location: string;
  durationMinutes: number;
  bufferMinutes: number;
  /** Antecedência mínima para marcar. */
  minNoticeHours: number;
  /** Até quantos dias à frente aparecem horários. */
  horizonDays: number;
  windows: WeeklyWindow[];
  blocks: ISchedulingBlock[];
  /** E-mail de confirmação; aceita {nome}, {data}, {hora}, {titulo}, {local}. */
  confirmationMessage: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SchedulingLinkSchema = new Schema<ISchedulingLink>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    slug: { type: String, required: true, unique: true },
    title: { type: String, trim: true, default: "Reunião" },
    description: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    durationMinutes: { type: Number, min: 10, max: 480, default: 30 },
    bufferMinutes: { type: Number, min: 0, max: 240, default: 0 },
    minNoticeHours: { type: Number, min: 0, max: 24 * 60, default: 12 },
    horizonDays: { type: Number, min: 1, max: 180, default: 30 },
    windows: {
      type: [new Schema({ weekday: Number, start: String, end: String }, { _id: false })],
      default: [],
    },
    blocks: {
      type: [new Schema({ start: Date, end: Date, note: { type: String, default: "" } })],
      default: [],
    },
    confirmationMessage: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

SchedulingLinkSchema.plugin(tenantPlugin);

const SchedulingLink: Model<ISchedulingLink> = models.SchedulingLink || model<ISchedulingLink>("SchedulingLink", SchedulingLinkSchema);

export default SchedulingLink;
