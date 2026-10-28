import { Router } from "express";
import {
  createToken,
  findPublicLead,
  getDefaults,
  getPublicSchema,
  getSchema,
  listTokens,
  publicNotFound,
  requireApiToken,
  requireJson,
  revokeToken,
  updateDefaults,
  upsertPublicLead,
} from "../controllers/automation.controller";
import { requireModule } from "../middlewares/auth";

/** Rotas públicas (webhooks / acesso por token), montadas antes do login. */
export const publicRouter = Router();

// API de automação (sistemas externos mandando leads). O token identifica a empresa.
publicRouter.get("/public/v1/schema", requireApiToken, getPublicSchema);
publicRouter.get("/public/v1/leads", requireApiToken, findPublicLead);
publicRouter.post("/public/v1/leads", requireApiToken, requireJson, upsertPublicLead);
publicRouter.all("/public/v1/*", publicNotFound);

/** Rotas internas (usuário logado), montadas depois do login. */
export const privateRouter = Router();

const settingsAccess = requireModule("configuracoes");
privateRouter.get("/automation/tokens", settingsAccess, listTokens);
privateRouter.post("/automation/tokens", settingsAccess, createToken);
privateRouter.delete("/automation/tokens/:id", settingsAccess, revokeToken);
privateRouter.get("/automation/defaults", settingsAccess, getDefaults);
privateRouter.put("/automation/defaults", settingsAccess, updateDefaults);
privateRouter.get("/automation/schema", settingsAccess, getSchema);
