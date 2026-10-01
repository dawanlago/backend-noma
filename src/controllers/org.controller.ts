import type { NextFunction, Request, Response } from "express";
import { isValidObjectId, Types } from "mongoose";
import { createOrganization } from "../lib/organizations";
import Organization from "../models/Organization";

const HEX = /^#[0-9a-fA-F]{6}$/;

function requireSuper(req: Request, res: Response) {
  if (req.user?.isSuperAdmin) return true;
  res.status(403).json({ error: "Só o administrador geral gerencia as empresas." });
  return false;
}

/** GET /orgs — empresas que o usuário pode abrir (o administrador geral vê também as inativas). */
export async function listOrgs(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.isSuperAdmin) {
      res.json({ data: await Organization.find().sort({ order: 1, createdAt: 1 }).lean() });
      return;
    }
    res.json({ data: req.access!.orgs });
  } catch (error) {
    next(error);
  }
}

/** POST /orgs { name, logo?, color?, copyFrom? } — copyFrom copia funis, opções e campos de outra empresa. */
export async function createOrg(req: Request, res: Response, next: NextFunction) {
  try {
    if (!requireSuper(req, res)) return;
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Informe o nome da empresa." });
      return;
    }
    const copyFrom = isValidObjectId(req.body?.copyFrom) && (await Organization.exists({ _id: req.body.copyFrom })) ? new Types.ObjectId(String(req.body.copyFrom)) : null;
    const org = await createOrganization({
      name,
      logo: typeof req.body.logo === "string" ? req.body.logo.trim() : "",
      color: HEX.test(req.body?.color) ? req.body.color : "",
      copyFrom,
    });
    res.status(201).json({ data: org.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateOrg(req: Request, res: Response, next: NextFunction) {
  try {
    if (!requireSuper(req, res)) return;
    const org = await Organization.findById(req.params.id);
    if (!org) {
      res.status(404).json({ error: "Empresa não encontrada." });
      return;
    }
    if (typeof req.body.name === "string" && req.body.name.trim()) org.name = req.body.name.trim();
    if (typeof req.body.logo === "string") org.logo = req.body.logo.trim();
    if (typeof req.body.color === "string") org.color = HEX.test(req.body.color) ? req.body.color : "";
    if (typeof req.body.isActive === "boolean") {
      if (!req.body.isActive && (await Organization.countDocuments({ isActive: true, _id: { $ne: org._id } })) === 0) {
        res.status(400).json({ error: "Mantenha pelo menos uma empresa ativa." });
        return;
      }
      org.isActive = req.body.isActive;
    }
    await org.save();
    res.json({ data: org.toJSON() });
  } catch (error) {
    next(error);
  }
}
