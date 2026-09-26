import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import {
  authorizationUrl,
  connectUser,
  disconnectUser,
  exchangeCode,
  googleConfigured,
  syncUpcoming,
  TIME_ZONE,
} from "../lib/googleCalendar";
import User from "../models/User";

const STATE_PURPOSE = "google-calendar";

function backToApp(res: Response, result: "conectado" | "erro" | "cancelado") {
  res.redirect(`${env.frontendUrl.replace(/\/+$/, "")}/agenda?google=${result}`);
}

/** GET /google/status */
export async function googleStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findById(req.user!._id).select("googleEmail googleConnectedAt").lean();
    res.json({
      data: {
        configured: googleConfigured(),
        connected: Boolean(user?.googleConnectedAt),
        email: user?.googleEmail || "",
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /google/connect → endereço de autorização do Google para o usuário logado. */
export function googleConnect(req: Request, res: Response) {
  if (!googleConfigured()) {
    res.status(503).json({ error: "Integração com o Google Agenda não configurada no servidor." });
    return;
  }
  const state = jwt.sign({ uid: String(req.user!._id), purpose: STATE_PURPOSE }, env.jwtSecret, { expiresIn: "10m" });
  res.json({ data: { url: authorizationUrl(state) } });
}

/** GET /google/callback (público: o Google redireciona o navegador para cá). */
export async function googleCallback(req: Request, res: Response) {
  if (!googleConfigured()) return backToApp(res, "erro");
  if (typeof req.query.error === "string") return backToApp(res, "cancelado");
  let userId = "";
  try {
    const payload = jwt.verify(String(req.query.state || ""), env.jwtSecret) as { uid?: string; purpose?: string };
    if (payload.purpose !== STATE_PURPOSE || !payload.uid) throw new Error("state inválido");
    userId = payload.uid;
  } catch {
    return backToApp(res, "erro");
  }
  try {
    const { refreshToken, email } = await exchangeCode(String(req.query.code || ""));
    await connectUser(userId, refreshToken, email);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
    await syncUpcoming(userId, today);
    return backToApp(res, "conectado");
  } catch (error) {
    console.error("[google-agenda] conexão:", error instanceof Error ? error.message : error);
    return backToApp(res, "erro");
  }
}

/** DELETE /google */
export async function googleDisconnect(req: Request, res: Response, next: NextFunction) {
  try {
    await disconnectUser(String(req.user!._id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
