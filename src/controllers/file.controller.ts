import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import StoredFile, { type IStoredFile } from "../models/StoredFile";
import { cloudinaryConfig, destroyAsset, isOwnCloudinaryUrl } from "../lib/cloudinary";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";

const CATEGORIES = ["contract"];

function notFound(res: Response) {
  res.status(404).json({ error: "Arquivo não encontrado." });
}

function applyLinks(file: IStoredFile, body: Record<string, unknown>) {
  if (typeof body.title === "string") file.title = body.title.trim();
  if (typeof body.notes === "string") file.notes = body.notes;
  for (const key of ["contactId", "companyId", "leadId"] as const) {
    if (body[key] !== undefined) {
      file[key] = (typeof body[key] === "string" && isValidObjectId(body[key]) ? body[key] : undefined) as never;
    }
  }
}

export async function listFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const category = CATEGORIES.includes(String(req.query.category)) ? String(req.query.category) : "contract";
    const docs = await StoredFile.find({ ...ownerScope(req), category }).sort({ createdAt: -1 }).lean();
    res.json({ data: await withOwnerNames(docs) });
  } catch (error) {
    next(error);
  }
}

/** POST /files — registra um arquivo já enviado ao Cloudinary pelo navegador. */
export async function registerFile(req: Request, res: Response, next: NextFunction) {
  try {
    const config = cloudinaryConfig();
    const category = String(req.body.category || "contract");
    if (!config) {
      res.status(503).json({ error: "O envio de arquivos não está configurado." });
      return;
    }
    if (!CATEGORIES.includes(category)) {
      res.status(400).json({ error: "Categoria de arquivo inválida." });
      return;
    }
    if (!isOwnCloudinaryUrl(req.body.url, config.cloudName) || typeof req.body.publicId !== "string") {
      res.status(400).json({ error: "Arquivo inválido." });
      return;
    }
    const file = new StoredFile({
      ownerId: req.user!._id,
      category,
      name: String(req.body.name || "arquivo").slice(0, 200),
      mimeType: String(req.body.mimeType || "application/octet-stream").slice(0, 120),
      size: Math.max(0, Number(req.body.size) || 0),
      url: req.body.url,
      publicId: req.body.publicId,
      resourceType: req.body.resourceType === "image" ? "image" : "raw",
    });
    applyLinks(file, req.body);
    if (!file.title) file.title = file.name.replace(/\.[^.]+$/, "");
    await file.save();
    res.status(201).json({ data: file.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateFile(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await StoredFile.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!file) return notFound(res);
    applyLinks(file, req.body);
    await file.save();
    res.json({ data: file.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteFile(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await StoredFile.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
    if (!file) return notFound(res);
    await destroyAsset(file.publicId, file.resourceType);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
