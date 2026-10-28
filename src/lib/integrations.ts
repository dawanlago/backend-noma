import type { NextFunction, Request, Response } from "express";
import Integration, { type IIntegration, type IntegrationProvider } from "../models/Integration";
import { open, seal } from "./secretBox";
import { acrossOrgs, runWithOrg } from "./tenant";

/**
 * Integrações por empresa. Os segredos ficam criptografados no banco; `secret()` devolve o texto puro
 * só para o servidor usar nas chamadas ao serviço externo.
 */
export interface IntegrationView {
  provider: IntegrationProvider;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Quais segredos estão preenchidos (nunca o valor). */
  secrets: Record<string, boolean>;
  hookKey: string;
}

export function viewOf(doc: IIntegration): IntegrationView {
  return {
    provider: doc.provider,
    enabled: doc.enabled,
    config: doc.config || {},
    secrets: Object.fromEntries(Object.entries(doc.secrets || {}).map(([key, value]) => [key, Boolean(value)])),
    hookKey: doc.hookKey,
  };
}

/** Integração da empresa atual (null se nunca foi configurada). */
export function findIntegration(provider: IntegrationProvider) {
  return Integration.findOne({ provider });
}

/** Integração da empresa atual, criando o registro vazio se não existir. */
export async function ensureIntegration(provider: IntegrationProvider) {
  return (await Integration.findOne({ provider })) || (await Integration.create({ provider, enabled: false }));
}

/** Segredo em texto puro ("" se não configurado ou ilegível). */
export function secret(doc: IIntegration | null | undefined, name: string): string {
  const sealed = doc?.secrets?.[name];
  if (!sealed) return "";
  try {
    return open(sealed);
  } catch {
    return "";
  }
}

/**
 * Atualiza config e segredos. Segredo `undefined` não muda; `""` apaga; texto novo é criptografado.
 * Config é mesclada (chaves `undefined` são ignoradas).
 */
export async function saveIntegration(
  provider: IntegrationProvider,
  input: { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string | undefined> },
) {
  const doc = await ensureIntegration(provider);
  if (typeof input.enabled === "boolean") doc.enabled = input.enabled;
  if (input.config) {
    const next = { ...(doc.config || {}) };
    for (const [key, value] of Object.entries(input.config)) if (value !== undefined) next[key] = value;
    doc.config = next;
    doc.markModified("config");
  }
  if (input.secrets) {
    const next = { ...(doc.secrets || {}) };
    for (const [key, value] of Object.entries(input.secrets)) {
      if (value === undefined) continue;
      if (value === "") delete next[key];
      else next[key] = seal(String(value));
    }
    doc.secrets = next;
    doc.markModified("secrets");
  }
  await doc.save();
  return doc;
}

/**
 * Rotas públicas de webhook: `/:hookKey` identifica a integração (e a empresa) sem login.
 * Coloca a integração em `res.locals.integration` e roda o resto dentro da empresa dela.
 */
export function integrationFromHook(provider: IntegrationProvider, param = "hookKey") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = String(req.params[param] || "");
      const doc = key ? await acrossOrgs(() => Integration.findOne({ provider, hookKey: key }).exec()) : null;
      if (!doc) {
        res.status(404).json({ error: "Integração não encontrada." });
        return;
      }
      res.locals.integration = doc;
      runWithOrg(doc.orgId, () => next());
    } catch (error) {
      next(error);
    }
  };
}
