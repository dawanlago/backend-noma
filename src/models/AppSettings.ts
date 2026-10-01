import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";

export interface IBrandColor {
  name: string;
  hex: string;
}

/** Configurações gerais de cada empresa (um documento por empresa, key = "main"). */
export interface IAppSettings extends Document {
  _id: Types.ObjectId;
  key: string;
  companyName: string;
  welcomeEyebrow: string;
  /** Aceita {nome} para o primeiro nome de quem está logado. */
  welcomeTitle: string;
  welcomeText: string;
  brand: {
    logo: string;
    colors: IBrandColor[];
    defaultColor: string;
  };
  /** Listas de opções que já receberam os valores padrão (não recria o que foi apagado). */
  seededLists: string[];
  /** Migrações de dados já aplicadas (rodam uma vez só). */
  migrations: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_SETTINGS = {
  companyName: "Produtora Noma",
  welcomeEyebrow: "Central Noma",
  welcomeTitle: "{nome}, tenha o controle do seu negócio para crescer a sua produtora.",
  welcomeText: "Ferramentas para administrar sua produtora audiovisual com mais clareza e profissionalismo.",
  brand: {
    logo: "",
    colors: [
      { name: "Vermelho Noma", hex: "#C8102E" },
      { name: "Preto Noma", hex: "#111111" },
    ],
    defaultColor: "#C8102E",
  },
};

const BrandColorSchema = new Schema<IBrandColor>(
  {
    name: { type: String, trim: true, default: "" },
    hex: { type: String, trim: true, match: /^#[0-9a-fA-F]{6}$/, required: true },
  },
  { _id: false },
);

const AppSettingsSchema = new Schema<IAppSettings>(
  {
    key: { type: String, required: true, default: "main" },
    companyName: { type: String, trim: true, default: DEFAULT_SETTINGS.companyName },
    welcomeEyebrow: { type: String, trim: true, default: DEFAULT_SETTINGS.welcomeEyebrow },
    welcomeTitle: { type: String, trim: true, default: DEFAULT_SETTINGS.welcomeTitle },
    welcomeText: { type: String, trim: true, default: DEFAULT_SETTINGS.welcomeText },
    brand: {
      logo: { type: String, default: "" },
      colors: { type: [BrandColorSchema], default: () => DEFAULT_SETTINGS.brand.colors },
      defaultColor: { type: String, default: DEFAULT_SETTINGS.brand.defaultColor },
    },
    seededLists: { type: [String], default: [] },
    migrations: { type: [String], default: [] },
  },
  { timestamps: true },
);

AppSettingsSchema.plugin(tenantPlugin);
// Um documento de configurações por empresa.
AppSettingsSchema.index({ orgId: 1, key: 1 }, { unique: true });

const AppSettings: Model<IAppSettings> =
  models.AppSettings || model<IAppSettings>("AppSettings", AppSettingsSchema);

export default AppSettings;
