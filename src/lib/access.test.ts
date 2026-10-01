import type { Request } from "express";
import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { accessLevels, defaultAccess, sanitizeAccess } from "./access";
import { ownerScope, ownerScopeFor, recordScope } from "./ownership";

describe("níveis de acesso por empresa", () => {
  it("admin vê tudo; vendedor vê só o dele e fica sem financeiro e configurações", () => {
    expect(new Set(Object.values(defaultAccess("admin")))).toEqual(new Set(["all"]));
    const seller = defaultAccess("seller");
    expect(seller.crm).toBe("own");
    expect(seller.financeiro).toBe("none");
    expect(seller.configuracoes).toBe("none");
    expect(defaultAccess("manager").financeiro).toBe("own");
  });

  it("o vínculo salvo sobrepõe o padrão do papel, menos para admin", () => {
    expect(accessLevels({ role: "seller", access: { crm: "all", financeiro: "own" } })).toMatchObject({ crm: "all", financeiro: "own", propostas: "own" });
    expect(accessLevels({ role: "admin", access: { crm: "none" } }).crm).toBe("all");
    expect(accessLevels({ role: "seller", access: { crm: "qualquer" as never } }).crm).toBe("own");
  });

  it("sanitizeAccess ignora módulos e níveis inválidos", () => {
    const access = sanitizeAccess({ crm: "all", inexistente: "all", financeiro: "tudo" }, "seller");
    expect(access.crm).toBe("all");
    expect(access.financeiro).toBe("none");
    expect(access).not.toHaveProperty("inexistente");
  });
});

describe("alcance pelo nível do módulo", () => {
  const userId = new Types.ObjectId();
  const other = String(new Types.ObjectId());
  const request = (scopeLevel?: string, levels: Record<string, string> = {}) =>
    ({ user: { _id: userId, role: "seller" }, query: { ownerId: other }, scopeLevel, access: { levels } }) as unknown as Request;

  it('"own" limita aos próprios registros; "all" libera a empresa e o filtro por usuário', () => {
    expect(ownerScope(request("own"))).toEqual({ ownerId: userId });
    expect(recordScope(request("own"))).toEqual({ ownerId: userId });
    expect(ownerScope(request("all"))).toEqual({ ownerId: other });
    expect(recordScope(request("all"))).toEqual({});
  });

  it("ownerScopeFor usa o nível do módulo pedido sem mudar o da rota", () => {
    const req = request("own", { financeiro: "all", crm: "own" });
    expect(ownerScopeFor(req, "financeiro")).toEqual({ ownerId: other });
    expect(ownerScopeFor(req, "crm")).toEqual({ ownerId: userId });
    expect(req.scopeLevel).toBe("own");
  });
});
