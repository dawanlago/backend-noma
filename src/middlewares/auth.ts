import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { hasModule } from "../lib/permissions";
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

    req.user = user;
    next();
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
    if (!hasModule(req.user, ...modules)) {
      res.status(403).json({ error: "Seu usuário não tem acesso a esta área." });
      return;
    }
    next();
  };
}
