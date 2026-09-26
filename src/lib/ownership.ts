import type { Request } from "express";
import { isValidObjectId, type Types } from "mongoose";
import User from "../models/User";

/** Admin vê tudo (ou filtra por ?ownerId=); os demais veem só os próprios registros. */
export function ownerScope(req: Request): Record<string, unknown> {
  const user = req.user!;
  if (user.role === "admin") {
    const { ownerId } = req.query;
    return typeof ownerId === "string" && isValidObjectId(ownerId) ? { ownerId } : {};
  }
  return { ownerId: user._id };
}

/** Escopo para ler ou alterar um registro específico: o admin acessa qualquer um. */
export function recordScope(req: Request): Record<string, unknown> {
  const user = req.user!;
  return user.role === "admin" ? {} : { ownerId: user._id };
}

/** Anexa `ownerName` aos documentos para o admin saber de quem é cada registro. */
export async function withOwnerNames<T extends { ownerId?: Types.ObjectId | string }>(docs: T[]) {
  // Registros antigos podem não ter dono: ignora ids inválidos em vez de quebrar a listagem.
  const ids = [...new Set(docs.map((doc) => String(doc.ownerId)).filter((id) => isValidObjectId(id)))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const names = new Map(users.map((user) => [String(user._id), user.name]));
  return docs.map((doc) => ({ ...doc, ownerName: names.get(String(doc.ownerId)) || "" }));
}

export function stripOwner(body: unknown) {
  const payload = { ...(body as Record<string, unknown>) };
  delete payload.ownerId;
  delete payload._id;
  delete payload.createdAt;
  delete payload.updatedAt;
  return payload;
}
