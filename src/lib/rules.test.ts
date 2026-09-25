import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { effectivePermissions, hasModule, sanitizePermissions } from "./permissions";
import { defaultItems, isValidList, KEYED_LISTS, slugify, uniqueValue } from "./optionLists";
import { firstOpenStage, firstStageOfKind, normalizeStages, removedStageIds } from "./funnels";
import { contactFromAnswers, normalizeFormFields, validateAnswers } from "./forms";
import { legacyLeadPatch } from "./leadMigration";

describe("permissões", () => {
  it("admin sempre tem todos os módulos, mesmo com lista salva", () => {
    expect(effectivePermissions({ role: "admin", permissions: ["crm"] })).toContain("financeiro");
  });

  it("usa a lista salva ou o padrão do papel", () => {
    expect(effectivePermissions({ role: "seller", permissions: ["crm", "financeiro"] })).toEqual(["crm", "financeiro"]);
    expect(hasModule({ role: "seller", permissions: [] }, "financeiro")).toBe(false);
    expect(hasModule({ role: "manager", permissions: [] }, "financeiro")).toBe(true);
  });

  it("descarta módulos inválidos", () => {
    expect(sanitizePermissions(["crm", "hack", "crm"])).toEqual(["crm"]);
    expect(sanitizePermissions("crm")).toEqual([]);
  });
});

describe("listas de opções", () => {
  it("listas com chave usam slug; as demais gravam o próprio texto", () => {
    expect(KEYED_LISTS).toContain("prospectOpportunity");
    expect(KEYED_LISTS).not.toContain("incomeCategory");
    expect(defaultItems("incomeCategory")[0]).toMatchObject({ value: "Contrato mensal", label: "Contrato mensal", order: 0 });
  });

  it("gera valores únicos", () => {
    expect(slugify("Vídeo de Produto!")).toBe("video_de_produto");
    expect(uniqueValue("a", ["a", "a_2"])).toBe("a_3");
  });

  it("aceita listas de campos personalizados", () => {
    expect(isValidList("field:0123456789abcdef01234567")).toBe(true);
    expect(isValidList("qualquer")).toBe(false);
  });
});

describe("funis", () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();

  it("mantém ids conhecidos, cria ids novos e ignora etapas sem nome", () => {
    const stages = normalizeStages(
      [{ _id: String(a), name: "Novo", kind: "open" }, { name: "Ganho", kind: "won" }, { name: " " }],
      [{ _id: a, key: "new" }],
    );
    expect(stages).toHaveLength(2);
    expect(String(stages[0]._id)).toBe(String(a));
    expect(stages[0].key).toBe("new");
    expect(stages[1].kind).toBe("won");
  });

  it("aponta etapas removidas e a etapa inicial", () => {
    const next = [{ _id: b, kind: "won" as const }];
    expect(removedStageIds([{ _id: a, kind: "open" }, ...next], next)).toEqual([String(a)]);
    expect(firstOpenStage([{ _id: b, kind: "won" as const }, { _id: a, kind: "open" as const }])?._id).toBe(a);
    expect(firstStageOfKind([{ _id: a, kind: "open" as const }], "won")).toBeUndefined();
  });
});

describe("formulários", () => {
  const fields = normalizeFormFields([
    { label: "Nome", required: true, target: "name" },
    { label: "E-mail", type: "email", target: "email" },
    { label: "Serviço", type: "multiselect", options: ["Reels", "Evento"] },
    { label: "Nome" },
  ]);

  it("gera chaves únicas", () => {
    expect(fields.map((field) => field.key)).toEqual(["nome", "e_mail", "servico", "nome_2"]);
  });

  it("valida obrigatórios, e-mail e opções", () => {
    expect(validateAnswers(fields, {}).error).toContain("Nome");
    expect(validateAnswers(fields, { nome: "Ana", e_mail: "x" }).error).toContain("e-mail");
    const ok = validateAnswers(fields, { nome: "Ana", e_mail: "ANA@x.com", servico: ["Reels", "Outro"] });
    expect(ok.error).toBe("");
    expect(ok.answers.servico).toEqual(["Reels"]);
    expect(contactFromAnswers(fields, ok.answers)).toMatchObject({ name: "Ana", email: "ana@x.com" });
  });
});

describe("migração dos leads antigos", () => {
  it("leva a etapa antiga para a etapa equivalente do funil padrão", () => {
    const funnelId = new Types.ObjectId();
    const stages = [
      { _id: new Types.ObjectId(), key: "new", kind: "open" as const },
      { _id: new Types.ObjectId(), key: "won", kind: "won" as const },
    ];
    const patch = legacyLeadPatch({ stage: "won", value: 1500 }, funnelId, stages);
    expect(patch).toMatchObject({ funnelId, stageId: stages[1]._id, status: "won", customValue: 1500, value: 1500 });
    expect(legacyLeadPatch({ stage: "sumiu" }, funnelId, stages).stageId).toBe(stages[0]._id);
  });
});
