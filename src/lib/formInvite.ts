import crypto from "crypto";
import { env } from "../config/env";
import FormInvite from "../models/FormInvite";

export function isFormInviteCode(value: string) {
  return /^\d{6}$/.test(value);
}

export function buildFormInviteUrl(code: string) {
  return `${env.frontendUrl.replace(/\/$/, "")}/formularios/${code}`;
}

export async function generateUniqueFormInviteCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const exists = await FormInvite.exists({ code });
    if (!exists) return code;
  }

  throw new Error("Não foi possível gerar um código de formulário.");
}
