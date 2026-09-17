import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
  if (!env.webhookSecret) {
    res.status(503).json({ error: "Webhook não configurado." });
    return;
  }

  const headerSecret = req.headers["x-webhook-secret"];
  const bodySecret = typeof req.body?.secret === "string" ? req.body.secret : undefined;
  const provided = headerSecret || bodySecret;

  if (provided !== env.webhookSecret) {
    res.status(401).json({ error: "Webhook não autorizado." });
    return;
  }

  next();
}
