import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Cartão do quadro de anotações. */
export interface INote extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  groupId: Types.ObjectId;
  title: string;
  content: string;
  color: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    groupId: { type: Schema.Types.ObjectId, ref: "NoteGroup", required: true },
    title: { type: String, trim: true, default: "" },
    content: { type: String, default: "" },
    color: { type: String, trim: true, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

NoteSchema.index({ ownerId: 1, groupId: 1, order: 1 });

const Note: Model<INote> = models.Note || model<INote>("Note", NoteSchema);

export default Note;
