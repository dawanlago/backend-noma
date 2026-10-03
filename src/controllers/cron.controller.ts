import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { runTick, sendWeeklyReport } from "../lib/cron";

/** Só o agendador (Vercel Cron ou externo) chama: header Authorization: Bearer <CRON_SECRET> ou ?key=. */
function authorized(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : String(req.query.key || "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** GET|POST /cron/tick — lembretes, resumo diário e relatório semanal. */
export async function cronTick(req: Request, res: Response, next: NextFunction) {
  try {
    if (!authorized(req)) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }
    res.json({ data: await runTick() });
  } catch (error) {
    next(error);
  }
}

/** POST /settings/weekly-report/test — manda o relatório agora para quem está logado (ou para os destinatários). */
export async function testWeeklyReport(req: Request, res: Response, next: NextFunction) {
  try {
    const to = req.body?.toMe ? [req.user!.email] : undefined;
    const sent = await sendWeeklyReport(Date.now(), to);
    if (!sent) {
      res.status(400).json({ error: "Não foi possível enviar: confira o envio de e-mail e os destinatários." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
