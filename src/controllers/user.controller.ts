import type { Request, Response, NextFunction } from "express";
import User from "../models/User";
import { sanitizePermissions } from "../lib/permissions";
import { DEFAULT_PERMISSIONS, type UserRole } from "../types";

const ROLES: UserRole[] = ["admin", "manager", "seller"];

function payloadFrom(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const key of ["name", "email", "password", "avatarUrl"] as const) {
    if (typeof body[key] === "string" && body[key]) payload[key] = body[key];
  }
  if (ROLES.includes(body.role as UserRole)) payload.role = body.role;
  if (typeof body.isActive === "boolean") payload.isActive = body.isActive;
  if (body.permissions !== undefined) payload.permissions = sanitizePermissions(body.permissions);
  return payload;
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = payloadFrom(req.body);
    const role = (payload.role as UserRole) || "seller";
    if (!payload.permissions || !(payload.permissions as string[]).length) payload.permissions = DEFAULT_PERMISSIONS[role];
    const user = await User.create(payload);
    res.status(201).json({ data: user.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    const payload = payloadFrom(req.body);
    if (String(user._id) === String(req.user!._id) && ((payload.role !== undefined && payload.role !== "admin") || payload.isActive === false)) {
      res.status(400).json({ error: "Você não pode remover o seu próprio acesso de administrador." });
      return;
    }

    Object.assign(user, payload);
    await user.save();

    res.json({ data: user.toJSON() });
  } catch (error) {
    next(error);
  }
}
