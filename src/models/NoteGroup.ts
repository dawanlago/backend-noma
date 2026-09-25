import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/** Coluna do quadro de anotações. */
export interface INoteGroup extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  color: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const NoteGroupSchema = new Schema<INoteGroup>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, trim: true, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

NoteGroupSchema.index({ ownerId: 1, order: 1 });

const NoteGroup: Model<INoteGroup> = models.NoteGroup || model<INoteGroup>("NoteGroup", NoteGroupSchema);

export default NoteGroup;
