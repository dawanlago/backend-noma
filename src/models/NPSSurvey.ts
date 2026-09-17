import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface INPSSurvey extends Document {
  _id: Types.ObjectId;
  name: string;
  question: string;
  commentPrompt?: string;
  thankYouMessage: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NPSSurveySchema = new Schema<INPSSurvey>(
  {
    name: { type: String, required: true, trim: true },
    question: { type: String, required: true, trim: true },
    commentPrompt: { type: String, trim: true },
    thankYouMessage: {
      type: String,
      trim: true,
      default: "Obrigado pela sua resposta.",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const NPSSurvey: Model<INPSSurvey> =
  models.NPSSurvey || model<INPSSurvey>("NPSSurvey", NPSSurveySchema);

export default NPSSurvey;
