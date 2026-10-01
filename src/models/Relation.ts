import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export const RELATION_KINDS = ["contact", "company", "lead"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export interface IRelationEnd {
  kind: RelationKind;
  id: Types.ObjectId;
}

/** Relação entre dois registros (contato, empresa ou negociação): "de" é [tipo] de "para". */
export interface IRelation extends Document {
  _id: Types.ObjectId;
  from: IRelationEnd;
  to: IRelationEnd;
  /** Tipo da relação (lista de opções `relationType`). */
  type: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const EndSchema = new Schema<IRelationEnd>(
  {
    kind: { type: String, enum: RELATION_KINDS, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const RelationSchema = new Schema<IRelation>(
  {
    from: { type: EndSchema, required: true },
    to: { type: EndSchema, required: true },
    type: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

RelationSchema.index({ orgId: 1, "from.id": 1 });
RelationSchema.index({ orgId: 1, "to.id": 1 });

RelationSchema.plugin(tenantPlugin);

const Relation: Model<IRelation> = models.Relation || model<IRelation>("Relation", RelationSchema);

export default Relation;
