import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { resolveAccess } from "../lib/access";
import { runWithOrg } from "../lib/tenant";
import { MODULES } from "../types";
import User from "../models/User";
import type { ModuleKey } from "../types";

interface AuthTokenPayload {
  userId: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ error: "Não autorizado" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    const user = await User.findById(payload.userId);

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const access = await resolveAccess(user, req.headers["x-org-id"]);
    if (!access) {
      res.status(403).json({ error: "Seu usuário não tem acesso a nenhuma empresa. Fale com um administrador." });
      return;
    }

    // Papel e módulos passam a valer para a empresa ativa (só em memória, nunca salvo).
    user.role = access.role;
    user.permissions = MODULES.filter((key) => access.levels[key] !== "none");
    req.user = user;
    req.access = access;
    // Daqui em diante toda consulta fica restrita à empresa ativa.
    runWithOrg(access.org._id, () => next());
  } catch {
    res.status(401).json({ error: "Não autorizado" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Não autorizado" });
    return;
  }

  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Acesso restrito a administradores." });
    return;
  }

  next();
}

/** Libera a rota se o usuário tiver acesso a pelo menos um dos módulos. */
export function requireModule(...modules: ModuleKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }
    // Vale o nível do primeiro módulo da lista a que o usuário tem acesso.
    const granted = modules.find((key) => req.access?.levels[key] && req.access.levels[key] !== "none");
    if (!granted) {
      res.status(403).json({ error: "Seu usuário não tem acesso a esta área." });
      return;
    }
    req.scopeLevel = req.access!.levels[granted];
    next();
  };
}
