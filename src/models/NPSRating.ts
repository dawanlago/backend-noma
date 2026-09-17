import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface INPSRating extends Document {
  _id: Types.ObjectId;
  surveyId?: Types.ObjectId;
  inviteId?: Types.ObjectId;
  contactId: Types.ObjectId;
  companyId?: Types.ObjectId;
  dealId?: Types.ObjectId;
  rating: number;
  comment?: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NPSRatingSchema = new Schema<INPSRating>(
  {
    surveyId: { type: Schema.Types.ObjectId, ref: "NPSSurvey" },
    inviteId: { type: Schema.Types.ObjectId, ref: "NPSInvite" },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    dealId: { type: Schema.Types.ObjectId, ref: "Deal" },
    rating: { type: Number, required: true, min: 0, max: 10 },
    comment: { type: String, trim: true },
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

NPSRatingSchema.index({ contactId: 1 });
NPSRatingSchema.index({ surveyId: 1 });
NPSRatingSchema.index({ inviteId: 1 }, { unique: true, sparse: true });
NPSRatingSchema.index({ companyId: 1 });
NPSRatingSchema.index({ date: -1 });

const NPSRating: Model<INPSRating> =
  models.NPSRating || model<INPSRating>("NPSRating", NPSRatingSchema);

export default NPSRating;
