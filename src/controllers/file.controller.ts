import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import FileChunk from "../models/FileChunk";
import StoredFile, { type IStoredFile } from "../models/StoredFile";
import { ownerScope, recordScope, withOwnerNames } from "../lib/ownership";

/** Cada parte tem no máximo 2 MB para caber no limite de requisição da hospedagem. */
export const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
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
    const docs = await StoredFile.find({ ...ownerScope(req), category, complete: true }).sort({ createdAt: -1 }).lean();
    res.json({ data: await withOwnerNames(docs) });
  } catch (error) {
    next(error);
  }
}

/** POST /files { name, mimeType, size, chunkCount, category, title, ... } — abre o envio. */
export async function startUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const size = Number(req.body.size) || 0;
    const chunkCount = Number(req.body.chunkCount) || 0;
    const category = String(req.body.category || "contract");
    if (!CATEGORIES.includes(category)) {
      res.status(400).json({ error: "Categoria de arquivo inválida." });
      return;
    }
    if (size <= 0 || size > MAX_FILE_BYTES) {
      res.status(400).json({ error: "O arquivo precisa ter até 25 MB." });
      return;
    }
    if (chunkCount < 1 || chunkCount !== Math.ceil(size / MAX_CHUNK_BYTES)) {
      res.status(400).json({ error: "Divisão do arquivo inválida." });
      return;
    }
    const file = new StoredFile({
      ownerId: req.user!._id,
      category,
      name: String(req.body.name || "arquivo").slice(0, 200),
      mimeType: String(req.body.mimeType || "application/octet-stream").slice(0, 120),
      size,
      chunkCount,
    });
    applyLinks(file, req.body);
    if (!file.title) file.title = file.name.replace(/\.[^.]+$/, "");
    await file.save();
    res.status(201).json({ data: file.toJSON() });
  } catch (error) {
    next(error);
  }
}

/** PUT /files/:id/chunks/:n { data: base64 } */
export async function putChunk(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await StoredFile.findOne({ _id: req.params.id, ownerId: req.user!._id, complete: false });
    if (!file) return notFound(res);
    const n = Number(req.params.n);
    const data = Buffer.from(String(req.body.data || ""), "base64");
    if (!Number.isInteger(n) || n < 0 || n >= file.chunkCount || !data.length || data.length > MAX_CHUNK_BYTES) {
      res.status(400).json({ error: "Parte do arquivo inválida." });
      return;
    }
    await FileChunk.updateOne({ fileId: file._id, n }, { $set: { data } }, { upsert: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function completeUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await StoredFile.findOne({ _id: req.params.id, ownerId: req.user!._id });
    if (!file) return notFound(res);
    const chunks = await FileChunk.aggregate<{ count: number; bytes: number }>([
      { $match: { fileId: file._id } },
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: { $binarySize: "$data" } } } },
    ]);
    const summary = chunks[0] || { count: 0, bytes: 0 };
    if (summary.count !== file.chunkCount || summary.bytes !== file.size) {
      res.status(400).json({ error: "O envio não terminou. Tente enviar o arquivo de novo." });
      return;
    }
    file.complete = true;
    await file.save();
    res.json({ data: file.toJSON() });
  } catch (error) {
    next(error);
  }
}

/** GET /files/:id/chunks/:n — o download também é feito em partes. */
export async function getChunk(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await StoredFile.findOne({ _id: req.params.id, ...recordScope(req), complete: true }).lean();
    if (!file) return notFound(res);
    // Sem .lean(): assim `data` vem como Buffer (no lean seria um Binary do driver).
    const chunk = await FileChunk.findOne({ fileId: file._id, n: Number(req.params.n) });
    if (!chunk) return notFound(res);
    res.json({ data: chunk.data.toString("base64") });
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
    await FileChunk.deleteMany({ fileId: file._id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
