import crypto from "crypto";
import { env } from "../config/env";

// Criptografia simétrica para segredos guardados no banco (ex.: refresh token do Google).
const key = crypto.createHash("sha256").update(`${env.jwtSecret}:secret-box`).digest();

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(".");
}

export function open(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
