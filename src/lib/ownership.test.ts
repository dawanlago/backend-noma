import type { Request } from "express";
import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { ownerScope, recordScope, stripOwner } from "./ownership";

const adminId = new Types.ObjectId();
const sellerId = new Types.ObjectId();

function request(role: string, userId: Types.ObjectId, query: Record<string, unknown> = {}) {
  return { user: { _id: userId, role }, query } as unknown as Request;
}

describe("ownerScope", () => {
  it("limita usuários comuns aos próprios registros, mesmo pedindo outro dono", () => {
    expect(ownerScope(request("seller", sellerId, { ownerId: String(adminId) }))).toEqual({ ownerId: sellerId });
    expect(ownerScope(request("manager", sellerId))).toEqual({ ownerId: sellerId });
  });

  it("deixa o admin ver tudo ou filtrar por um usuário", () => {
    expect(ownerScope(request("admin", adminId))).toEqual({});
    expect(ownerScope(request("admin", adminId, { ownerId: String(sellerId) }))).toEqual({ ownerId: String(sellerId) });
  });

  it("ignora ownerId inválido", () => {
    expect(ownerScope(request("admin", adminId, { ownerId: "nope" }))).toEqual({});
    expect(ownerScope(request("admin", adminId, { ownerId: { $ne: null } }))).toEqual({});
  });
});

describe("recordScope", () => {
  it("admin acessa qualquer registro; os demais só os seus", () => {
    expect(recordScope(request("admin", adminId))).toEqual({});
    expect(recordScope(request("seller", sellerId))).toEqual({ ownerId: sellerId });
  });
});

describe("stripOwner", () => {
  it("impede trocar o dono ou o id pelo corpo da requisição", () => {
    expect(stripOwner({ ownerId: "x", _id: "y", createdAt: 1, updatedAt: 2, name: "Ana" })).toEqual({ name: "Ana" });
  });
});
