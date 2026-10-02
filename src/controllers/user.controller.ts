import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { accessLevels, sanitizeAccess } from "../lib/access";
import User, { type IUser } from "../models/User";
import { MODULES, type UserRole } from "../types";

const ROLES: UserRole[] = ["admin", "manager", "seller"];

/** Empresas em que quem está logado é administrador (são as que ele pode gerenciar nos usuários). */
function managedOrgIds(req: Request): string[] {
  return req.access!.orgs.filter((org) => org.role === "admin").map((org) => org._id);
}

/**
 * Usuário para a tela de usuários: papel/níveis na empresa ativa (compatível com o resto do sistema)
 * e `memberships` com o acesso em cada empresa que o administrador gerencia.
 */
function inOrg(user: IUser, orgId: string, managed: string[] = []) {
  const membershipOf = (id: string) =>
    user.isSuperAdmin ? { role: "admin" as UserRole, access: {} } : user.memberships.find((item) => String(item.orgId) === id);
  const active = membershipOf(orgId) || { role: "seller" as UserRole, access: {} };
  const access = accessLevels(active);
  const json = user.toJSON() as unknown as Record<string, unknown>;
  return {
    ...json,
    role: active.role,
    access,
    permissions: MODULES.filter((key) => access[key] !== "none"),
    memberships: managed
      .map((id) => ({ id, membership: membershipOf(id) }))
      .filter((item) => item.membership)
      .map((item) => ({ orgId: item.id, role: item.membership!.role, access: accessLevels(item.membership!) })),
  };
}

const orgOf = (req: Request) => String(req.access!.org._id);

/** Usuários de qualquer empresa que o administrador gerencia (e os administradores gerais). */
const managedFilter = (managed: string[]) => ({ $or: [{ "memberships.orgId": { $in: managed } }, { isSuperAdmin: true }] });

/**
 * GET /users — na empresa ativa: quem tem acesso a ela (filtros por responsável etc.).
 * Com ?scope=managed (tela de usuários): todo mundo das empresas que o administrador gerencia.
 */
export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const managed = req.query.scope === "managed" && req.user!.role === "admin" ? managedOrgIds(req) : [];
    const filter = managed.length ? managedFilter(managed) : { $or: [{ "memberships.orgId": orgId }, { isSuperAdmin: true }] };
    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({ data: users.map((user) => inOrg(user, orgId, managed)) });
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

/**
 * Vínculos pedidos pelo formulário, só das empresas que o administrador gerencia.
 * `memberships: [{ orgId, role, access }]` = acesso por empresa (as que não vierem ficam sem acesso).
 * Sem `memberships` (formato antigo): `fallback` decide — todas as gerenciadas ao criar, só a ativa ao editar.
 */
function membershipsFrom(req: Request, fallback: string[], current: IUser["memberships"] = []) {
  const managed = managedOrgIds(req);
  const body = req.body as Record<string, unknown>;
  const currentOf = (id: string) => current.find((item) => String(item.orgId) === id);
  if (Array.isArray(body.memberships)) {
    return (body.memberships as Record<string, unknown>[])
      .filter((item) => managed.includes(String(item?.orgId)))
      .map((item) => ({ orgId: new Types.ObjectId(String(item.orgId)), ...membershipFrom(item, currentOf(String(item.orgId))) }));
  }
  return fallback.map((id) => ({ orgId: new Types.ObjectId(id), ...membershipFrom(body, currentOf(id)) }));
}

/** Troca os vínculos das empresas gerenciadas pelos novos; os de outras empresas não mudam. */
function replaceManaged(user: IUser, managed: string[], next: IUser["memberships"]) {
  user.memberships = [...user.memberships.filter((item) => !managed.includes(String(item.orgId))), ...next];
  user.markModified("memberships");
}

/**
 * POST /users — um cadastro só: a pessoa entra em todas as empresas que o administrador gerencia
 * (ou nas escolhidas em `memberships`). Se o e-mail já existe, só ganha esses acessos.
 */
export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const managed = managedOrgIds(req);
    const email = String(req.body?.email || "").trim().toLowerCase();
    const memberships = membershipsFrom(req, managed);
    if (!memberships.length) {
      res.status(400).json({ error: "Escolha pelo menos uma empresa para este usuário." });
      return;
    }
    const existing = email ? await User.findOne({ email }) : null;
    if (existing) {
      if (existing.memberships.some((item) => managed.includes(String(item.orgId)))) {
        res.status(409).json({ error: "Este e-mail já está cadastrado. Edite o usuário para mudar as empresas e os acessos." });
        return;
      }
      existing.memberships.push(...memberships);
      await existing.save();
      res.status(201).json({ data: inOrg(existing, orgId, managed) });
      return;
    }
    const user = await User.create({ ...profileFrom(req.body), role: memberships[0].role, memberships });
    res.status(201).json({ data: inOrg(user, orgId, managed) });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = orgOf(req);
    const managed = managedOrgIds(req);
    const user = await User.findOne({ _id: req.params.id, ...managedFilter(managed) });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    const profile = profileFrom(req.body);
    const isSelf = String(user._id) === String(req.user!._id);
    const changesAccess = req.body.memberships !== undefined || req.body.role !== undefined || req.body.access !== undefined || req.body.permissions !== undefined;
    Object.assign(user, profile);
    // O administrador geral é admin em todas as empresas: os vínculos dele não mudam aqui.
    if (!user.isSuperAdmin && changesAccess) {
      const next = membershipsFrom(req, [orgId], user.memberships);
      if (isSelf && next.find((item) => String(item.orgId) === orgId)?.role !== "admin") {
        res.status(400).json({ error: "Você não pode remover o seu próprio acesso de administrador." });
        return;
      }
      // Formato antigo (sem `memberships`) mexe só na empresa ativa.
      replaceManaged(user, Array.isArray(req.body.memberships) ? managed : [orgId], next);
    }
    if (isSelf && profile.isActive === false) {
      res.status(400).json({ error: "Você não pode bloquear o seu próprio acesso." });
      return;
    }
    if (!user.isSuperAdmin && !user.memberships.length) {
      res.status(400).json({ error: "O usuário precisa ter acesso a pelo menos uma empresa. Para tirar de todas, use Remover." });
      return;
    }
    await user.save();
    res.json({ data: inOrg(user, orgId, managed) });
  } catch (error) {
    next(error);
  }
}

/** DELETE /users/:id — tira o acesso às empresas que o administrador gerencia; sem nenhuma outra, o usuário é apagado. */
export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const managed = managedOrgIds(req);
    const user = await User.findOne({ _id: req.params.id, "memberships.orgId": { $in: managed } });
    if (!user || user.isSuperAdmin) {
      res.status(user ? 400 : 404).json({ error: user ? "O administrador geral não pode ser removido." : "Usuário não encontrado." });
      return;
    }
    if (String(user._id) === String(req.user!._id)) {
      res.status(400).json({ error: "Você não pode remover o seu próprio acesso." });
      return;
    }
    replaceManaged(user, managed, []);
    if (user.memberships.length) await user.save();
    else await user.deleteOne();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
