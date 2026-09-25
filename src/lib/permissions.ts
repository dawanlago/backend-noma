import { DEFAULT_PERMISSIONS, MODULES, type ModuleKey, type UserRole } from "../types";

interface PermissionSubject {
  role: UserRole;
  permissions?: string[] | null;
}

/** Módulos liberados: o admin tem tudo; os demais usam a lista salva ou o padrão do papel. */
export function effectivePermissions(user: PermissionSubject): ModuleKey[] {
  if (user.role === "admin") return [...MODULES];
  const stored = Array.isArray(user.permissions) && user.permissions.length ? user.permissions : null;
  const list = stored || DEFAULT_PERMISSIONS[user.role] || [];
  return MODULES.filter((key) => list.includes(key));
}

export function hasModule(user: PermissionSubject, ...keys: ModuleKey[]) {
  const allowed = effectivePermissions(user);
  return keys.some((key) => allowed.includes(key));
}

/** Mantém só chaves de módulo válidas, sem repetição. */
export function sanitizePermissions(value: unknown): ModuleKey[] {
  if (!Array.isArray(value)) return [];
  return MODULES.filter((key) => value.includes(key));
}
