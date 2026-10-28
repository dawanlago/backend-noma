import type { NextFunction, Request, Response } from "express";
import Integration, { type IntegrationProvider } from "../models/Integration";
import { saveIntegration, viewOf } from "../lib/integrations";

const PROVIDERS: IntegrationProvider[] = ["zapi", "assinafy", "anthropic", "automation"];

/** Segredos que cada integração aceita pela tela de Configurações → Integrações. */
const SECRET_KEYS: Record<IntegrationProvider, string[]> = {
  zapi: ["token", "clientToken"],
  assinafy: ["apiKey"],
  anthropic: ["apiKey"],
  automation: [],
};

/** Campos de configuração (visíveis) aceitos por integração. */
const CONFIG_KEYS: Record<IntegrationProvider, string[]> = {
  zapi: ["instanceId", "funnelId", "ownerId", "autoCreateLeads", "confirmBookings"],
  assinafy: ["accountId", "environment"],
  anthropic: ["model", "bookingPrompt"],
  automation: ["funnelId", "stageId", "ownerId"],
};

function providerOf(req: Request, res: Response): IntegrationProvider | null {
  const provider = req.params.provider as IntegrationProvider;
  if (PROVIDERS.includes(provider)) return provider;
  res.status(404).json({ error: "Integração desconhecida." });
  return null;
}

/** GET /integrations — situação de todas as integrações (sem os segredos). */
export async function listIntegrations(_req: Request, res: Response, next: NextFunction) {
  try {
    const docs = await Integration.find();
    res.json({ data: docs.map(viewOf) });
  } catch (error) {
    next(error);
  }
}

/** PUT /integrations/:provider { enabled?, config?, secrets? } */
export async function updateIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    const provider = providerOf(req, res);
    if (!provider) return;
    const body = (req.body || {}) as { enabled?: unknown; config?: Record<string, unknown>; secrets?: Record<string, unknown> };
    const config = Object.fromEntries(
      Object.entries(body.config || {}).filter(([key]) => CONFIG_KEYS[provider].includes(key)),
    );
    const secrets = Object.fromEntries(
      Object.entries(body.secrets || {})
        .filter(([key, value]) => SECRET_KEYS[provider].includes(key) && typeof value === "string")
        .map(([key, value]) => [key, String(value).trim()]),
    );
    const doc = await saveIntegration(provider, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      config,
      secrets,
    });
    res.json({ data: viewOf(doc) });
  } catch (error) {
    next(error);
  }
}
