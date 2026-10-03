import type { NextFunction, Request, Response } from "express";
import AppSettings from "../models/AppSettings";
import { emailConfigured, sendMail, testMail } from "../lib/email";
import { getSettings } from "../lib/seedDefaults";
import { normalizeRules, type LateChargeRules } from "../lib/lateCharge";

const HEX = /^#[0-9a-fA-F]{6}$/;

function publicSettings(doc: InstanceType<typeof AppSettings>) {
  const json = doc.toJSON() as unknown as Record<string, unknown>;
  delete json.seededLists;
  delete json.migrations;
  return json;
}

export async function readSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: publicSettings(await getSettings()) });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await getSettings();
    const body = req.body as Record<string, unknown>;
    for (const key of ["companyName", "welcomeEyebrow", "welcomeTitle", "welcomeText"] as const) {
      if (typeof body[key] === "string") doc[key] = body[key] as string;
    }
    const brand = body.brand as Record<string, unknown> | undefined;
    if (brand && typeof brand === "object") {
      if (typeof brand.logo === "string") doc.brand.logo = brand.logo;
      if (Array.isArray(brand.colors)) {
        doc.brand.colors = brand.colors
          .map((color) => color as { name?: unknown; hex?: unknown })
          .filter((color) => typeof color.hex === "string" && HEX.test(color.hex))
          .map((color) => ({ name: String(color.name || "").trim(), hex: String(color.hex).toUpperCase() }));
      }
      if (typeof brand.defaultColor === "string" && HEX.test(brand.defaultColor)) {
        doc.brand.defaultColor = brand.defaultColor.toUpperCase();
      }
      doc.markModified("brand");
    }
    const finance = body.finance as Partial<LateChargeRules> | undefined;
    if (finance && typeof finance === "object") {
      doc.finance = normalizeRules({ ...normalizeRules(doc.finance), ...finance });
      doc.markModified("finance");
    }
    // Relatório semanal: liga/desliga, dia, hora e destinatários (e-mails válidos).
    const report = body.weeklyReport as Record<string, unknown> | undefined;
    if (report && typeof report === "object") {
      const current = doc.weeklyReport || { enabled: false, recipients: [], weekday: 1, hour: 8 };
      if (typeof report.enabled === "boolean") current.enabled = report.enabled;
      if (Array.isArray(report.recipients)) {
        current.recipients = [...new Set(report.recipients.map((item) => String(item).trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(item)))].slice(0, 20);
      }
      if (Number.isInteger(report.weekday) && Number(report.weekday) >= 0 && Number(report.weekday) <= 6) current.weekday = Number(report.weekday);
      if (Number.isInteger(report.hour) && Number(report.hour) >= 0 && Number(report.hour) <= 23) current.hour = Number(report.hour);
      doc.set("weeklyReport", current);
    }
    await doc.save();
    res.json({ data: publicSettings(doc) });
  } catch (error) {
    next(error);
  }
}

/** POST /settings/test-email { to? } — manda um e-mail de teste (padrão: para quem está logado). */
export async function sendTestEmail(req: Request, res: Response, next: NextFunction) {
  try {
    if (!emailConfigured()) {
      res.status(400).json({ error: "Envio de e-mail não configurado no servidor (SMTP_HOST, SMTP_USER e SMTP_PASS)." });
      return;
    }
    const to = typeof req.body?.to === "string" && req.body.to.includes("@") ? req.body.to.trim() : req.user!.email;
    try {
      res.json({ data: await sendMail(testMail(to)) });
    } catch (error) {
      const err = error as Error & { responseCode?: number };
      res.status(502).json({ error: `O servidor de e-mail recusou o envio: ${err.message}` });
    }
  } catch (error) {
    next(error);
  }
}
