import bcrypt from "bcryptjs";
import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { AccessLevel, UserRole } from "../types";

/** Acesso do usuário a uma empresa: papel e, por módulo, até onde ele enxerga. */
export interface IMembership {
  orgId: Types.ObjectId;
  role: UserRole;
  /** módulo → "none" | "own" (só o que criou) | "all" (tudo da empresa). O admin tem "all" em tudo. */
  access: Record<string, AccessLevel>;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  avatarUrl?: string;
  isActive: boolean;
  /** Módulos liberados (vazio = padrão do papel). O admin sempre tem todos. */
  permissions: string[];
  /** Empresas a que o usuário tem acesso. */
  memberships: IMembership[];
  /** Administrador geral: cria empresas e é admin em todas. */
  isSuperAdmin: boolean;
  /** Google Agenda conectado (o refresh token fica criptografado e fora das consultas). */
  googleEmail?: string;
  googleRefreshToken?: string;
  googleConnectedAt?: Date;
  /** Preferências de avisos (valem em todas as empresas). */
  notificationPrefs: {
    /** Minutos antes do compromisso com hora para avisar (0 = não avisar). */
    reminderMinutes: number;
    /** Também mandar lembretes por e-mail. */
    emailReminders: boolean;
    /** Resumo diário de manhã com atividades do dia e atrasadas. */
    dailyDigest: boolean;
  };
  /** Último resumo diário enviado (YYYY-MM-DD). */
  lastDigestDate?: string;
  /** Redefinição de senha: hash do código enviado por e-mail e validade. */
  resetTokenHash?: string;
  resetTokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(plainPassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["admin", "manager", "seller"],
      default: "seller",
    },
    avatarUrl: { type: String },
    isActive: { type: Boolean, default: true },
    permissions: { type: [String], default: [] },
    memberships: {
      type: [
        new Schema<IMembership>(
          {
            orgId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
            role: { type: String, enum: ["admin", "manager", "seller"], default: "seller" },
            access: { type: Schema.Types.Mixed, default: {} },
          },
          { _id: false, minimize: false },
        ),
      ],
      default: [],
    },
    isSuperAdmin: { type: Boolean, default: false },
    googleEmail: { type: String, default: "" },
    googleRefreshToken: { type: String, select: false },
    googleConnectedAt: { type: Date },
    notificationPrefs: {
      reminderMinutes: { type: Number, min: 0, max: 7 * 24 * 60, default: 60 },
      emailReminders: { type: Boolean, default: true },
      dailyDigest: { type: Boolean, default: true },
    },
    lastDigestDate: { type: String, default: "" },
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false },
  },
  { timestamps: true },
);

UserSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 10);
});

UserSchema.methods.comparePassword = async function comparePassword(
  plainPassword: string,
) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(plainPassword, this.password);
};

UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.googleRefreshToken;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpiresAt;
    return ret;
  },
});

const User: Model<IUser> = models.User || model<IUser>("User", UserSchema);

export default User;
