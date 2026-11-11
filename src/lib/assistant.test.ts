import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const create = vi.fn();
vi.mock("./ai", () => ({
  FALLBACK_MODELS: ["claude-opus-5-5"],
  aiClient: vi.fn(async () => ({ client: { beta: { messages: { create } } }, model: "claude-opus-5-5", bookingPrompt: "" })),
}));

const { askAssistant, runToolCall } = await import("./assistant");

/** Usuário sem acesso a nada: as ferramentas recusam sem tocar no banco. */
const req = { user: { name: "Lai" }, access: { levels: { crm: "none", agenda: "none", propostas: "none", base: "none", financeiro: "none" } } } as unknown as Request;

const message = (stop_reason: string, content: unknown[]) => ({ stop_reason, content });

describe("assistente: loop de ferramentas", () => {
  beforeEach(() => create.mockReset());

  it("recusa ferramentas de áreas sem acesso e ferramentas desconhecidas", async () => {
    const denied = await runToolCall(req, { id: "t1", name: "resumo_crm", input: {} });
    expect(denied).toMatchObject({ tool_use_id: "t1", is_error: true });
    expect(String(denied.content)).toContain("não tem acesso à área CRM");
    const unknown = await runToolCall(req, { id: "t2", name: "apagar_tudo", input: {} });
    expect(unknown).toMatchObject({ is_error: true, content: "Ferramenta desconhecida." });
  });

  it("devolve todos os resultados numa mensagem e segue até a resposta final", async () => {
    create
      .mockResolvedValueOnce(
        message("tool_use", [
          { type: "tool_use", id: "a", name: "agenda", input: { de: "2026-11-01", ate: "2026-11-07" } },
          { type: "tool_use", id: "b", name: "resumo_financeiro", input: {} },
        ]),
      )
      .mockResolvedValueOnce(message("end_turn", [{ type: "text", text: "Você não tem acesso a essas áreas." }]));

    const answer = await askAssistant(req, [{ role: "user", content: "O que tenho esta semana?" }], "Noma");
    expect(answer.reply).toBe("Você não tem acesso a essas áreas.");
    expect(create).toHaveBeenCalledTimes(2);

    const second = create.mock.calls[1][0];
    // Pergunta (com a data de hoje), resposta completa do Claude, e uma única mensagem com os dois resultados.
    expect(second.messages[0].content).toMatch(/^\[Hoje é \d{2}\/\d{2}\/\d{4}\]\nO que tenho esta semana\?$/);
    expect(second.messages[1].role).toBe("assistant");
    expect(second.messages[2].content.map((block: { tool_use_id: string }) => block.tool_use_id)).toEqual(["a", "b"]);
    expect(second.tools.every((tool: Record<string, unknown>) => !("module" in tool) && !("area" in tool))).toBe(true);
  });

  it("trata recusa de segurança sem quebrar", async () => {
    create.mockResolvedValueOnce(message("refusal", []));
    const answer = await askAssistant(req, [{ role: "user", content: "..." }], "Noma");
    expect(answer.reply).toContain("Não consigo ajudar");
  });
});
