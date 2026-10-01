import bcrypt from "bcryptjs";
import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import type { UserRole } from "../types";

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
  /** Google Agenda conectado (o refresh token fica criptografado e fora das consultas). */
  googleEmail?: string;
  googleRefreshToken?: string;
  googleConnectedAt?: Date;
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
    googleEmail: { type: String, default: "" },
    googleRefreshToken: { type: String, select: false },
    googleConnectedAt: { type: Date },
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
