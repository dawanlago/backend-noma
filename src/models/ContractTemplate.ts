import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

/**
 * Modelo de contrato da produtora. O texto usa {{variáveis}} preenchidas
 * pelo Gerador de Contratos; "# " marca o título e "## " as seções.
 */
export interface IContractTemplate extends Document {
  _id: Types.ObjectId;
  name: string;
  body: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ContractTemplateSchema = new Schema<IContractTemplate>(
  {
    name: { type: String, required: true, trim: true },
    body: { type: String, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const ContractTemplate: Model<IContractTemplate> =
  models.ContractTemplate || model<IContractTemplate>("ContractTemplate", ContractTemplateSchema);

export default ContractTemplate;
