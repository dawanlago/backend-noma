import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { NotePermission } from "../types";

export interface INoteShare {
  userId: Types.ObjectId;
  permission: NotePermission;
}

export interface INote extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  groupId?: Types.ObjectId;
  title: string;
  content: string;
  shares: INoteShare[];
  createdAt: Date;
  updatedAt: Date;
}

const NoteShareSchema = new Schema<INoteShare>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    permission: {
      type: String,
      enum: ["view", "edit"],
      default: "view",
    },
  },
  { _id: false },
);

const NoteSchema = new Schema<INote>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    groupId: { type: Schema.Types.ObjectId, ref: "NoteGroup" },
    title: { type: String, required: true, trim: true, default: "Sem título" },
    content: { type: String, default: "" },
    shares: { type: [NoteShareSchema], default: [] },
  },
  { timestamps: true },
);

NoteSchema.index({ userId: 1, groupId: 1, updatedAt: -1 });
NoteSchema.index({ "shares.userId": 1 });

const Note: Model<INote> = models.Note || model<INote>("Note", NoteSchema);

export default Note;
