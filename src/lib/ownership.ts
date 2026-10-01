import type { Request } from "express";
import { isValidObjectId, type Types } from "mongoose";
import User from "../models/User";
import type { ModuleKey } from "../types";

/** Alcance da rota: o nível do módulo (definido em requireModule) ou, sem ele, o do papel. */
function seesAll(req: Request) {
  return (req.scopeLevel || (req.user!.role === "admin" ? "all" : "own")) === "all";
}

/** Quem vê tudo da empresa pode filtrar por ?ownerId=; os demais veem só os próprios registros. */
export function ownerScope(req: Request): Record<string, unknown> {
  const user = req.user!;
  if (seesAll(req)) {
    const { ownerId } = req.query;
    return typeof ownerId === "string" && isValidObjectId(ownerId) ? { ownerId } : {};
  }
  return { ownerId: user._id };
}

/** Define o alcance desta requisição pelo nível do usuário no módulo (rotas sem requireModule). */
export function useModuleScope(req: Request, module: ModuleKey) {
  const level = req.access?.levels[module];
  if (level && level !== "none") req.scopeLevel = level;
}

/** `ownerScope` com o nível de um módulo específico (ex.: painel, que junta CRM e financeiro). */
export function ownerScopeFor(req: Request, module: ModuleKey): Record<string, unknown> {
  const previous = req.scopeLevel;
  useModuleScope(req, module);
  const scope = ownerScope(req);
  req.scopeLevel = previous;
  return scope;
}

/** Escopo para ler ou alterar um registro específico: quem vê tudo acessa qualquer um da empresa. */
export function recordScope(req: Request): Record<string, unknown> {
  const user = req.user!;
  return seesAll(req) ? {} : { ownerId: user._id };
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
