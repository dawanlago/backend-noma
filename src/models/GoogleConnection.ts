import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IGoogleConnection extends Document {
  _id: Types.ObjectId;
  provider: "google_calendar";
  refreshToken: string;
  calendarId: string;
  connectedEmail?: string;
  connectedBy?: Types.ObjectId;
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GoogleConnectionSchema = new Schema<IGoogleConnection>(
  {
    provider: { type: String, enum: ["google_calendar"], default: "google_calendar", unique: true },
    refreshToken: { type: String, required: true },
    calendarId: { type: String, required: true, default: "primary" },
    connectedEmail: { type: String, trim: true },
    connectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    connectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const GoogleConnection: Model<IGoogleConnection> =
  models.GoogleConnection || model<IGoogleConnection>("GoogleConnection", GoogleConnectionSchema);

export default GoogleConnection;
