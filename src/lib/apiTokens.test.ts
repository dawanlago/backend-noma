import { describe, expect, it } from "vitest";
import {
  bearerToken,
  createRateLimiter,
  generateToken,
  hashToken,
  isTokenFormat,
  normalizeBrPhone,
  parseLeadPayload,
} from "./apiTokens";

describe("tokens da API de automação", () => {
  it("gera token no formato noma_live_ com hash sha256 e prefixo visível", () => {
    const { token, hash, prefix } = generateToken();
    expect(isTokenFormat(token)).toBe(true);
    expect(token.startsWith("noma_live_")).toBe(true);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix).toHaveLength(14);
    expect(generateToken().token).not.toBe(token);
    expect(isTokenFormat("noma_live_curto")).toBe(false);
  });

  it("lê o header Authorization", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer  abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBe("");
    expect(bearerToken(undefined)).toBe("");
  });
});

describe("telefone brasileiro", () => {
  it("aceita com ou sem 55 e máscara", () => {
    expect(normalizeBrPhone("11987654321")).toBe("5511987654321");
    expect(normalizeBrPhone("+55 (11) 98765-4321")).toBe("5511987654321");
    expect(normalizeBrPhone("5511987654321")).toBe("5511987654321");
    expect(normalizeBrPhone("(21) 3456-7890")).toBe("552134567890");
    expect(normalizeBrPhone("552134567890")).toBe("552134567890");
  });

  it("recusa números inválidos", () => {
    expect(normalizeBrPhone("")).toBeNull();
    expect(normalizeBrPhone("12345")).toBeNull();
    expect(normalizeBrPhone("01987654321")).toBeNull();
    expect(normalizeBrPhone("11887654321")).toBeNull();
    expect(normalizeBrPhone("1112345678")).toBeNull();
    expect(normalizeBrPhone("11 9abc 4321")).toBeNull();
  });
});

describe("corpo do POST de lead", () => {
  it("normaliza um lead válido", () => {
    const result = parseLeadPayload(
      { name: " Ana ", phone: "(11) 98765-4321", email: "ANA@Mail.com", stage: "qualified", custom: { orcamento: "10k" }, extra: 1 },
      ["orcamento"],
    );
    expect(result.errors).toEqual([]);
    expect(result.ignored).toEqual(["extra"]);
    expect(result.value).toMatchObject({ name: "Ana", phone: "5511987654321", email: "ana@mail.com", qualify: true, source: "API", custom: { orcamento: "10k" } });
  });

  it("exige telefone ou e-mail e valida formatos", () => {
    expect(parseLeadPayload({ name: "Ana" }, []).errors.map((item) => item.field)).toEqual(["phone"]);
    const fields = parseLeadPayload({ phone: "123", email: "x@", funnelId: "abc", stage: "won", custom: { nao: 1 } }, []).errors.map((item) => item.field);
    expect(fields).toEqual(["phone", "email", "funnelId", "stage", "custom.nao"]);
    expect(parseLeadPayload([], []).errors[0].field).toBe("body");
    expect(parseLeadPayload({ email: "a@b.com", qualify: "sim" }, []).errors[0].field).toBe("qualify");
  });

  it("não aceita stageId junto com qualificado", () => {
    const result = parseLeadPayload({ email: "a@b.com", qualify: true, stageId: "507f1f77bcf86cd799439011" }, []);
    expect(result.errors.map((item) => item.field)).toEqual(["stageId"]);
  });
});

describe("limite de requisições", () => {
  it("bloqueia acima do limite e libera na janela seguinte", () => {
    const limiter = createRateLimiter(2, 60_000);
    expect(limiter.hit("t", 0).allowed).toBe(true);
    expect(limiter.hit("t", 1).allowed).toBe(true);
    expect(limiter.hit("t", 2)).toMatchObject({ allowed: false, remaining: 0, resetAt: 60_000 });
    expect(limiter.hit("outro", 2).allowed).toBe(true);
    expect(limiter.hit("t", 60_000).allowed).toBe(true);
  });
});
