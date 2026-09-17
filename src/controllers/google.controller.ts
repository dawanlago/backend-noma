import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleAuthUrl,
  getGoogleCalendarStatus,
} from "../lib/googleCalendar";

export async function getGoogleStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getGoogleCalendarStatus() });
  } catch (error) {
    next(error);
  }
}

export async function getGoogleConnectUrl(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: { url: getGoogleAuthUrl() } });
  } catch (error) {
    next(error);
  }
}

export async function googleCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const code = String(req.query.code || "");
    if (!code) {
      res.redirect(`${env.frontendUrl}/configuracoes?google=error`);
      return;
    }

    await connectGoogleCalendar(code, req.user?._id.toString());
    res.redirect(`${env.frontendUrl}/configuracoes?google=connected`);
  } catch (error) {
    console.error(error);
    res.redirect(`${env.frontendUrl}/configuracoes?google=error`);
  }
}

export async function disconnectGoogle(req: Request, res: Response, next: NextFunction) {
  try {
    await disconnectGoogleCalendar();
    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}
