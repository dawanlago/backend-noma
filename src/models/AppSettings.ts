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
  /** Juros/multa por atraso de recebimentos (0 = não cobra). */
  finance: {
    lateFee: number;
    monthlyInterest: number;
    graceDays: number;
  };
  /** Listas de opções que já receberam os valores padrão (não recria o que foi apagado). */
  seededLists: string[];
  /** Migrações de dados já aplicadas (rodam uma vez só). */
  migrations: string[];
  /** Relatório semanal por e-mail: dia (0 = domingo) e hora (Brasília) de envio e destinatários. */
  weeklyReport: {
    enabled: boolean;
    recipients: string[];
    weekday: number;
    hour: number;
    lastSentAt?: Date;
  };
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
    finance: {
      lateFee: { type: Number, min: 0, max: 100, default: 0 },
      monthlyInterest: { type: Number, min: 0, max: 100, default: 0 },
      graceDays: { type: Number, min: 0, max: 365, default: 0 },
    },
    seededLists: { type: [String], default: [] },
    migrations: { type: [String], default: [] },
    weeklyReport: {
      enabled: { type: Boolean, default: false },
      recipients: { type: [String], default: [] },
      weekday: { type: Number, min: 0, max: 6, default: 1 },
      hour: { type: Number, min: 0, max: 23, default: 8 },
      lastSentAt: { type: Date },
    },
  },
  { timestamps: true },
);

AppSettingsSchema.plugin(tenantPlugin);
// Um documento de configurações por empresa.
AppSettingsSchema.index({ orgId: 1, key: 1 }, { unique: true });

const AppSettings: Model<IAppSettings> =
  models.AppSettings || model<IAppSettings>("AppSettings", AppSettingsSchema);

export default AppSettings;
