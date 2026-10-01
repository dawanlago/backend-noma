import { isValidObjectId } from "mongoose";
import Organization, { type IOrganization } from "../models/Organization";
import type { IMembership, IUser } from "../models/User";
import { ACCESS_LEVELS, DEFAULT_PERMISSIONS, MODULES, type AccessLevel, type ModuleKey, type UserRole } from "../types";

export type AccessLevels = Record<ModuleKey, AccessLevel>;

/** Acesso padrão do papel: admin vê tudo; os demais veem só o que criaram nos módulos do papel. */
export function defaultAccess(role: UserRole): AccessLevels {
  const allowed = DEFAULT_PERMISSIONS[role] || [];
  return Object.fromEntries(
    MODULES.map((key) => [key, role === "admin" ? "all" : allowed.includes(key) ? "own" : "none"]),
  ) as AccessLevels;
}

/** Níveis efetivos de um vínculo: o admin tem tudo; módulo sem nível salvo usa o padrão do papel. */
export function accessLevels(membership: Pick<IMembership, "role" | "access">): AccessLevels {
  const base = defaultAccess(membership.role);
  if (membership.role === "admin") return base;
  const saved = membership.access || {};
  for (const key of MODULES) {
    const level = saved[key];
    if (ACCESS_LEVELS.includes(level as AccessLevel)) base[key] = level as AccessLevel;
  }
  return base;
}

/** Mantém só módulos e níveis válidos. */
export function sanitizeAccess(value: unknown, role: UserRole): AccessLevels {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const base = defaultAccess(role);
  for (const key of MODULES) {
    if (ACCESS_LEVELS.includes(input[key] as AccessLevel)) base[key] = input[key] as AccessLevel;
  }
  return base;
}

export interface ResolvedAccess {
  org: IOrganization;
  role: UserRole;
  levels: AccessLevels;
  /** Empresas que o usuário pode abrir (para o seletor). */
  orgs: { _id: string; name: string; logo: string; color: string; role: UserRole }[];
}

/**
 * Empresa ativa e acesso do usuário nela. Usa a empresa pedida (header X-Org-Id) se ele
 * tiver acesso; senão, a primeira disponível. null = usuário sem nenhuma empresa.
 */
export async function resolveAccess(user: IUser, requestedOrgId?: unknown): Promise<ResolvedAccess | null> {
  const all = await Organization.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  const memberships = user.memberships || [];
  const membershipOf = (org: IOrganization): Pick<IMembership, "role" | "access"> | undefined =>
    user.isSuperAdmin ? { role: "admin", access: {} } : memberships.find((item) => String(item.orgId) === String(org._id));
  const available = all.filter((org) => membershipOf(org));
  if (!available.length) return null;
  const requested = typeof requestedOrgId === "string" && isValidObjectId(requestedOrgId) ? requestedOrgId : "";
  const org = available.find((item) => String(item._id) === requested) || available[0];
  const membership = membershipOf(org)!;
  return {
    org,
    role: membership.role,
    levels: accessLevels(membership),
    orgs: available.map((item) => ({
      _id: String(item._id),
      name: item.name,
      logo: item.logo,
      color: item.color,
      role: membershipOf(item)!.role,
    })),
  };
}

/** Usuário como o frontend espera: papel e módulos da empresa ativa + lista de empresas. */
export function sessionUser(user: IUser, access: ResolvedAccess) {
  const json = user.toJSON() as unknown as Record<string, unknown>;
  delete json.memberships;
  return {
    ...json,
    role: access.role,
    permissions: MODULES.filter((key) => access.levels[key] !== "none"),
    access: access.levels,
    orgId: String(access.org._id),
    orgs: access.orgs,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}
