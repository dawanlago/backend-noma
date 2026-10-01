import { AsyncLocalStorage } from "async_hooks";
import { Schema, Types } from "mongoose";

/**
 * Separação por empresa. Cada requisição roda "dentro" de uma empresa (orgId);
 * o plugin abaixo aplica esse filtro em toda consulta e carimba os registros novos,
 * para que nenhum controller precise lembrar de filtrar.
 *
 * Sem contexto (inicialização, migrações, rotas públicas antes de descobrir a empresa)
 * as consultas não são filtradas — mas criar um registro sem empresa dá erro.
 */
interface TenantStore {
  orgId: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function currentOrgId(): string | undefined {
  return storage.getStore()?.orgId;
}

/** Executa `fn` dentro da empresa informada. */
export function runWithOrg<T>(orgId: Types.ObjectId | string, fn: () => T): T {
  return storage.run({ orgId: String(orgId) }, fn);
}

/** Filtro da empresa atual, para operações que não passam pelos hooks (ex.: bulkWrite). */
export function orgFilter(): { orgId?: Types.ObjectId } {
  const orgId = currentOrgId();
  return orgId ? { orgId: new Types.ObjectId(orgId) } : {};
}

const QUERY_HOOKS = [
  "find",
  "findOne",
  "countDocuments",
  "distinct",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
] as const;

export function tenantPlugin(schema: Schema) {
  schema.add({ orgId: { type: Schema.Types.ObjectId, ref: "Organization", index: true } });

  schema.pre(QUERY_HOOKS as unknown as "find", function scopeQuery() {
    const orgId = currentOrgId();
    if (orgId) this.where({ orgId: new Types.ObjectId(orgId) });
  });

  schema.pre("aggregate", function scopeAggregate() {
    const orgId = currentOrgId();
    if (orgId) this.pipeline().unshift({ $match: { orgId: new Types.ObjectId(orgId) } });
  });

  schema.pre("save", function stampOrg() {
    if (!this.isNew || this.get("orgId")) return;
    const orgId = currentOrgId();
    if (!orgId) throw new Error(`Registro sem empresa: ${(this.constructor as { modelName?: string }).modelName || "documento"}.`);
    this.set("orgId", new Types.ObjectId(orgId));
  });

  schema.pre("insertMany", function stampMany(...args: unknown[]) {
    const orgId = currentOrgId();
    const docs = args.find((arg) => Array.isArray(arg)) as Record<string, unknown>[] | undefined;
    if (!docs) return;
    for (const doc of docs) {
      if (doc.orgId) continue;
      if (!orgId) throw new Error("Registro sem empresa (insertMany).");
      doc.orgId = new Types.ObjectId(orgId);
    }
  });
}
