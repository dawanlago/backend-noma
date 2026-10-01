import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

/**
 * Item de uma lista de opções configurável (serviços, nichos, categorias...).
 * `value` é o que fica gravado nos registros; `meta` guarda extras da lista
 * (ex.: mensagens de cada oportunidade na prospecção).
 */
export interface IOptionItem extends Document {
  _id: Types.ObjectId;
  list: string;
  value: string;
  label: string;
  order: number;
  color: string;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const OptionItemSchema = new Schema<IOptionItem>(
  {
    list: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    color: { type: String, trim: true, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

OptionItemSchema.index({ orgId: 1, list: 1, value: 1 }, { unique: true });
OptionItemSchema.index({ list: 1, order: 1 });

OptionItemSchema.plugin(tenantPlugin);

const OptionItem: Model<IOptionItem> =
  models.OptionItem || model<IOptionItem>("OptionItem", OptionItemSchema);

export default OptionItem;
