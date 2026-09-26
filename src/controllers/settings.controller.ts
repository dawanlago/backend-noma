import type { NextFunction, Request, Response } from "express";
import AppSettings from "../models/AppSettings";
import { getSettings } from "../lib/seedDefaults";

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
    await doc.save();
    res.json({ data: publicSettings(doc) });
  } catch (error) {
    next(error);
  }
}
