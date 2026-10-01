import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, type CustomFieldEntity, type CustomFieldType } from "../types";

/** Campo extra criado nas configurações. As opções ficam na lista `field:<id>`. */
export interface ICustomField extends Document {
  _id: Types.ObjectId;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const CustomFieldSchema = new Schema<ICustomField>(
  {
    entity: { type: String, enum: CUSTOM_FIELD_ENTITIES, required: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: CUSTOM_FIELD_TYPES, default: "text" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

CustomFieldSchema.index({ orgId: 1, entity: 1, key: 1 }, { unique: true });

CustomFieldSchema.plugin(tenantPlugin);

const CustomField: Model<ICustomField> =
  models.CustomField || model<ICustomField>("CustomField", CustomFieldSchema);

export default CustomField;
