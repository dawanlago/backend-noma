import type { Request, Response, NextFunction } from "express";
import { accessLevels, sanitizeAccess } from "../lib/access";
import User, { type IUser } from "../models/User";
import { MODULES, type UserRole } from "../types";

const ROLES: UserRole[] = ["admin", "manager", "seller"];

/** Usuário como aparece na empresa ativa: papel e níveis de acesso dela. */
function inOrg(user: IUser, orgId: string) {
  const membership = user.isSuperAdmin
    ? { role: "admin" as UserRole, access: {} }
    : user.memberships.find((item) => String(item.orgId) === orgId) || { role: "seller" as UserRole, access: {} };
  const access = accessLevels(membership);
  const json = user.toJSON() as unknown as Record<string, unknown>;
  delete json.memberships;
  return { ...json, role: membership.role, access, permissions: MODULES.filter((key) => access[key] !== "none") };
}

const orgOf = (req: Request) => String(req.access!.org._id);

/** GET /users — quem tem acesso à empresa ativa (inclui os administradores gerais). */
export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const users = await User.find({ $or: [{ "memberships.orgId": orgId }, { isSuperAdmin: true }] }).sort({ createdAt: -1 });
    res.json({ data: users.map((user) => inOrg(user, orgId)) });
  } catch (error) {
    next(error);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const user = await User.findOne({ _id: req.params.id, $or: [{ "memberships.orgId": orgId }, { isSuperAdmin: true }] });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    res.json({ data: inOrg(user, orgId) });
  } catch (error) {
    next(error);
  }
}

function profileFrom(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const key of ["name", "email", "password", "avatarUrl"] as const) {
    if (typeof body[key] === "string" && body[key]) payload[key] = body[key];
  }
  if (typeof body.isActive === "boolean") payload.isActive = body.isActive;
  return payload;
}

/** Papel e níveis de acesso enviados pelo formulário (aceita também a lista antiga de módulos). */
function membershipFrom(body: Record<string, unknown>, current?: { role: UserRole; access: Record<string, unknown> }) {
  const role = ROLES.includes(body.role as UserRole) ? (body.role as UserRole) : current?.role || "seller";
  let input: unknown = body.access;
  if (input === undefined && Array.isArray(body.permissions)) {
    input = Object.fromEntries(MODULES.map((key) => [key, (body.permissions as unknown[]).includes(key) ? "own" : "none"]));
  }
  // Sem níveis enviados: mantém os atuais se o papel não mudou; senão, o padrão do papel novo.
  if (input === undefined && current && current.role === role) input = current.access;
  return { role, access: sanitizeAccess(input, role) };
}

/** POST /users — cria o usuário nesta empresa; se o e-mail já existe, só dá acesso a ela. */
export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.access!.org._id;
    const email = String(req.body?.email || "").trim().toLowerCase();
    const membership = { orgId, ...membershipFrom(req.body) };
    const existing = email ? await User.findOne({ email }) : null;
    if (existing) {
      if (existing.memberships.some((item) => String(item.orgId) === String(orgId))) {
        res.status(409).json({ error: "Este e-mail já tem acesso a esta empresa." });
        return;
      }
      existing.memberships.push(membership);
      await existing.save();
      res.status(201).json({ data: inOrg(existing, String(orgId)) });
      return;
    }
    const user = await User.create({ ...profileFrom(req.body), role: membership.role, memberships: [membership] });
    res.status(201).json({ data: inOrg(user, String(orgId)) });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const user = await User.findOne({ _id: req.params.id, $or: [{ "memberships.orgId": orgId }, { isSuperAdmin: true }] });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    const profile = profileFrom(req.body);
    const isSelf = String(user._id) === String(req.user!._id);
    if (isSelf && ((req.body.role !== undefined && req.body.role !== "admin") || profile.isActive === false)) {
      res.status(400).json({ error: "Você não pode remover o seu próprio acesso de administrador." });
      return;
    }
    Object.assign(user, profile);
    // O administrador geral é admin em todas as empresas: o vínculo dele não muda aqui.
    if (!user.isSuperAdmin && (req.body.role !== undefined || req.body.access !== undefined || req.body.permissions !== undefined)) {
      const index = user.memberships.findIndex((item) => String(item.orgId) === orgId);
      const next = { orgId: req.access!.org._id, ...membershipFrom(req.body, user.memberships[index]) };
      if (index >= 0) user.memberships[index] = next;
      else user.memberships.push(next);
      user.markModified("memberships");
    }
    await user.save();
    res.json({ data: inOrg(user, orgId) });
  } catch (error) {
    next(error);
  }
}

/** DELETE /users/:id — tira o acesso a esta empresa; sem nenhuma outra, o usuário é apagado. */
export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const user = await User.findOne({ _id: req.params.id, "memberships.orgId": orgId });
    if (!user || user.isSuperAdmin) {
      res.status(user ? 400 : 404).json({ error: user ? "O administrador geral não pode ser removido de uma empresa." : "Usuário não encontrado." });
      return;
    }
    if (String(user._id) === String(req.user!._id)) {
      res.status(400).json({ error: "Você não pode remover o seu próprio acesso." });
      return;
    }
    user.memberships = user.memberships.filter((item) => String(item.orgId) !== orgId);
    if (user.memberships.length) await user.save();
    else await user.deleteOne();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
