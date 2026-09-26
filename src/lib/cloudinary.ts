import { createHash } from "crypto";
import { env } from "../config/env";

export type CloudinaryResource = "image" | "raw";

/** Pastas permitidas no Cloudinary (tudo fica dentro de "noma/"). */
export const UPLOAD_FOLDERS = ["contatos", "empresas", "marca", "contratos", "propostas", "arquivos"] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export function cloudinaryConfig() {
  return env.cloudinary;
}

/** Assinatura do Cloudinary: sha1 dos parâmetros em ordem alfabética + api secret. */
export function signParams(params: Record<string, string | number>, apiSecret: string) {
  const payload = Object.keys(params)
    .filter((key) => params[key] !== "" && params[key] !== undefined)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(payload + apiSecret).digest("hex");
}

/** A URL precisa ser de um arquivo da nossa conta (evita salvar links de terceiros). */
export function isOwnCloudinaryUrl(url: unknown, cloudName: string) {
  return typeof url === "string" && url.startsWith(`https://res.cloudinary.com/${cloudName}/`);
}

/** Apaga o arquivo no Cloudinary (melhor esforço: falha não impede apagar o registro). */
export async function destroyAsset(publicId: string, resourceType: CloudinaryResource) {
  const config = cloudinaryConfig();
  if (!config || !publicId) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ public_id: publicId, timestamp }, config.apiSecret);
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: config.apiKey, signature });
  try {
    await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/destroy`, { method: "POST", body });
  } catch (error) {
    console.log("[cloudinary:destroy-failed]", error instanceof Error ? error.message : error);
  }
}
