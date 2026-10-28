import { Router } from "express";
import {
  assinafyWebhook,
  cancelSignature,
  createSignature,
  downloadSignedFile,
  getSignature,
  refreshSignature,
} from "../controllers/assinafy.controller";
import { integrationFromHook } from "../lib/integrations";
import { requireModule } from "../middlewares/auth";

/** Rotas públicas (webhooks / acesso por token), montadas antes do login. */
export const publicRouter = Router();

// Avisos da Assinafy (assinou, recusou, documento certificado...). O :hookKey identifica a empresa.
publicRouter.post("/public/webhooks/assinafy/:hookKey", integrationFromHook("assinafy"), assinafyWebhook);

/** Rotas internas (usuário logado), montadas depois do login. */
export const privateRouter = Router();

// Assinatura eletrônica de um contrato (documento da ferramenta de contratos).
const contractsAccess = requireModule("contratos");
privateRouter.get("/contracts/:documentId/signature", contractsAccess, getSignature);
privateRouter.post("/contracts/:documentId/signature", contractsAccess, createSignature);
privateRouter.post("/contracts/:documentId/signature/refresh", contractsAccess, refreshSignature);
privateRouter.get("/contracts/:documentId/signature/file", contractsAccess, downloadSignedFile);
privateRouter.delete("/contracts/:documentId/signature", contractsAccess, cancelSignature);
