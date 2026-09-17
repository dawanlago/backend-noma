import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface INoteGroup extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const NoteGroupSchema = new Schema<INoteGroup>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

NoteGroupSchema.index({ userId: 1, order: 1 });

const NoteGroup: Model<INoteGroup> =
  models.NoteGroup || model<INoteGroup>("NoteGroup", NoteGroupSchema);

export default NoteGroup;
