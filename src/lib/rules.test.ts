import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { effectivePermissions, hasModule, sanitizePermissions } from "./permissions";
import { defaultItems, isValidList, KEYED_LISTS, slugify, uniqueValue } from "./optionLists";
import { firstOpenStage, firstStageOfKind, normalizeStages, removedStageIds } from "./funnels";
import { contactFromAnswers, normalizeFormFields, validateAnswers } from "./forms";
import { legacyLeadPatch } from "./leadMigration";
import { npsGroup, npsScore } from "./nps";
import { upcomingBirthdays } from "./birthdays";
import { phoneKey, samePhone } from "./phone";
import { isOwnCloudinaryUrl, signParams } from "./cloudinary";
import { legacyAnswers, legacyDealToLead, legacyFormFields, legacyStageKind, legacyTaskPatch, splitLegacyDate } from "./legacyMigration";

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

describe("NPS", () => {
  it("classifica e calcula a nota (% promotores − % detratores)", () => {
    expect([10, 9, 8, 7, 6, 0].map(npsGroup)).toEqual(["promoter", "promoter", "passive", "passive", "detractor", "detractor"]);
    expect(npsScore([10, 9, 8, 3])).toBe(25);
    expect(npsScore([])).toBe(0);
  });
});

describe("Cloudinary", () => {
  it("assina como a documentação (exemplo oficial)", () => {
    const params = { eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 };
    expect(signParams(params, "abcd")).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("só aceita URLs da própria conta", () => {
    expect(isOwnCloudinaryUrl("https://res.cloudinary.com/minha/raw/upload/x.pdf", "minha")).toBe(true);
    expect(isOwnCloudinaryUrl("https://res.cloudinary.com/outra/raw/upload/x.pdf", "minha")).toBe(false);
  });
});

describe("migração da primeira versão", () => {
  it("etapa 'closure' vira venda feita; demais ficam em andamento", () => {
    const id = new Types.ObjectId();
    expect(legacyStageKind({ _id: id, name: "Fechamento", type: "closure" })).toBe("won");
    expect(legacyStageKind({ _id: id, name: "Agenda", type: "agenda" })).toBe("open");
    expect(legacyStageKind({ _id: id, name: "Perdido", kind: "lost" })).toBe("lost");
  });

  it("converte data/hora antiga para Brasília", () => {
    expect(splitLegacyDate(new Date("2026-10-05T13:30:00Z"))).toEqual({ dueDate: "2026-10-05", time: "10:30" });
    expect(splitLegacyDate(null)).toEqual({ dueDate: "", time: "" });
  });

  it("tarefa antiga ganha dono, status e negociação", () => {
    const userId = new Types.ObjectId();
    const dealId = new Types.ObjectId();
    const patch = legacyTaskPatch({ userId, dueDate: new Date("2026-10-05T13:30:00Z"), isCompleted: true, description: "Levar tripé", dealId }, new Set([String(dealId)]));
    expect(patch.$set).toMatchObject({ ownerId: userId, dueDate: "2026-10-05", time: "10:30", status: "done", done: true, notes: "Levar tripé", leadId: dealId });
  });

  it("negociação antiga vira lead com pareceres, valor e mesma etapa", () => {
    const stageOpen = { _id: new Types.ObjectId(), name: "Lead", type: "general" };
    const stageWon = { _id: new Types.ObjectId(), name: "Fechamento", type: "closure" };
    const funnel = { _id: new Types.ObjectId(), stages: [stageOpen, stageWon] };
    const owner = new Types.ObjectId();
    const lead = legacyDealToLead(
      {
        _id: new Types.ObjectId(),
        title: "Casamento",
        funnelId: funnel._id,
        currentStageId: stageWon._id,
        value: 5000,
        temperature: "hot",
        ownerUserId: owner,
        source: "manual",
        dossier: { manualNotes: "Cliente indicou" },
        notes: [{ text: "Fechou!", userId: owner, date: new Date() }],
      },
      { funnels: [funnel], products: new Map(), userNames: new Map([[String(owner), "Lai"]]), contactNames: new Map(), companyNames: new Map() },
    );
    expect(lead).toMatchObject({ name: "Casamento", status: "won", stageId: stageWon._id, value: 5000, customValue: 5000, temperature: "hot", source: "", notes: "Cliente indicou" });
    expect(lead.comments[0]).toMatchObject({ text: "Fechou!", authorName: "Lai" });
  });

  it("formulário e respostas antigos", () => {
    const fields = legacyFormFields([
      { key: "email", label: "E-mail", type: "email", order: 1 },
      { key: "nome", label: "Nome", type: "text", required: true, order: 0 },
      { key: "aceite", label: "Aceite", type: "boolean", order: 2 },
    ]);
    expect(fields.map((field) => [field.key, field.target, field.type])).toEqual([
      ["nome", "name", "text"],
      ["email", "email", "email"],
      ["aceite", "", "checkbox"],
    ]);
    expect(legacyAnswers([{ key: "nome", value: "Ana" }])).toEqual({ nome: "Ana" });
  });
});

describe("aniversários", () => {
  it("lista os próximos, vira o ano e trata 29/02", () => {
    const people = [
      { _id: 1, name: "Hoje", birthDate: "1990-09-27" },
      { _id: 2, name: "Semana", birthDate: "1985-10-02" },
      { _id: 3, name: "Longe", birthDate: "2000-12-25" },
      { _id: 4, name: "Janeiro", birthDate: "1995-01-03" },
      { _id: 5, name: "Bissexto", birthDate: "1992-02-29" },
      { _id: 6, name: "Sem data", birthDate: "" },
    ];
    const list = upcomingBirthdays(people, "2026-09-27", 15);
    expect(list.map((p) => [p.name, p.daysUntil, p.age])).toEqual([
      ["Hoje", 0, 36],
      ["Semana", 5, 41],
    ]);
    expect(upcomingBirthdays(people, "2026-12-30", 10).map((p) => [p.name, p.date])).toEqual([["Janeiro", "2027-01-03"]]);
    expect(upcomingBirthdays(people, "2027-02-27", 3).map((p) => p.date)).toEqual(["2027-02-28"]);
  });
});

describe("telefone", () => {
  it("reconhece o mesmo celular com máscara, DDI e sem o 9", () => {
    expect(samePhone("(11) 98888-7777", "5511988887777")).toBe(true);
    expect(samePhone("(11) 98888-7777", "551188887777")).toBe(true);
    expect(samePhone("11 8888-7777", "+55 11 98888-7777")).toBe(true);
    // Caso real: WhatsApp mostra sem o 9, o cadastro tem o 9.
    expect(samePhone("(73) 98893-6370", "+55 73 8893-6370")).toBe(true);
    expect(samePhone("(73) 98893-6370", "557388936370")).toBe(true);
  });

  it("não confunde DDDs nem números curtos", () => {
    expect(samePhone("(11) 98888-7777", "(21) 98888-7777")).toBe(false);
    expect(samePhone("", "")).toBe(false);
    expect(phoneKey("1234")).toBe("");
  });

  it("fixo brasileiro e número estrangeiro", () => {
    expect(phoneKey("(11) 3333-4444")).toBe("1133334444");
    expect(samePhone("+1 415 555 0100", "14155550100")).toBe(true);
  });
});
