import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Link único de NPS enviado a um contato (responde uma vez). */
export interface INPSInvite extends Document {
  _id: Types.ObjectId;
  token: string;
  surveyId: Types.ObjectId;
  contactId: Types.ObjectId;
  companyId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  ownerId: Types.ObjectId;
  status: "pending" | "answered";
  answeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NPSInviteSchema = new Schema<INPSInvite>(
  {
    token: { type: String, required: true, unique: true },
    surveyId: { type: Schema.Types.ObjectId, ref: "NPSSurvey", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "answered"], default: "pending" },
    answeredAt: { type: Date },
  },
  { timestamps: true },
);

NPSInviteSchema.index({ surveyId: 1, contactId: 1, status: 1 });

const NPSInvite: Model<INPSInvite> = models.NPSInvite || model<INPSInvite>("NPSInvite", NPSInviteSchema);

export default NPSInvite;
