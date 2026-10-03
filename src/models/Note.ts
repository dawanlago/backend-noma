import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export type NotePermission = "view" | "edit";

export interface INoteShare {
  userId: Types.ObjectId;
  /** "view" = só leitura; "edit" = pode editar título e texto. */
  permission: NotePermission;
}

/** Anotação livre. Sem grupo, aparece em "Anotações sem grupo". */
export interface INote extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  groupId?: Types.ObjectId;
  title: string;
  /** Markdown (as anotações antigas em texto puro abrem como Markdown). */
  content: string;
  /** Revisão do título/texto: cada edição soma 1 (trava otimista contra edição simultânea). */
  rev: number;
  order: number;
  /** Usuários com acesso à anotação e a permissão de cada um. */
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
    rev: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    shares: {
      type: [
        new Schema<INoteShare>(
          {
            userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
            permission: { type: String, enum: ["view", "edit"], default: "view" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

NoteSchema.index({ ownerId: 1, groupId: 1, order: 1 });
NoteSchema.index({ "shares.userId": 1 });

NoteSchema.plugin(tenantPlugin);

const Note: Model<INote> = models.Note || model<INote>("Note", NoteSchema);

export default Note;
