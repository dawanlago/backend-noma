import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface INoteShare {
  userId: Types.ObjectId;
}

/** Anotação livre. Sem grupo, aparece em "Anotações sem grupo". */
export interface INote extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  groupId?: Types.ObjectId;
  title: string;
  content: string;
  order: number;
  /** Usuários que podem ler a anotação. */
  shares: INoteShare[];
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    groupId: { type: Schema.Types.ObjectId, ref: "NoteGroup" },
    title: { type: String, trim: true, default: "Sem título" },
    content: { type: String, default: "" },
    order: { type: Number, default: 0 },
    shares: { type: [new Schema<INoteShare>({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { _id: false })], default: [] },
  },
  { timestamps: true },
);

NoteSchema.index({ ownerId: 1, groupId: 1, order: 1 });
NoteSchema.index({ "shares.userId": 1 });

NoteSchema.plugin(tenantPlugin);

const Note: Model<INote> = models.Note || model<INote>("Note", NoteSchema);

export default Note;
