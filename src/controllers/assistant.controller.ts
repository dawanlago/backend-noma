import Anthropic from "@anthropic-ai/sdk";
import type { NextFunction, Request, Response } from "express";
import { askAssistant, AssistantUnavailableError, type ChatTurn } from "../lib/assistant";
import { getSettings } from "../lib/seedDefaults";

/** POST /assistant/chat { messages: [{ role: "user" | "assistant", content }] } — a última é a pergunta. */
export async function chatWithAssistant(req: Request, res: Response, next: NextFunction) {
  try {
    const input = Array.isArray(req.body?.messages) ? (req.body.messages as Record<string, unknown>[]) : [];
    const turns: ChatTurn[] = input
      .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim())
      .map((item) => ({ role: item.role as ChatTurn["role"], content: (item.content as string).trim().slice(0, 4000) }));
    // A conversa precisa começar e terminar com uma mensagem da pessoa.
    while (turns.length && turns[0].role !== "user") turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== "user") {
      res.status(400).json({ error: "Escreva uma pergunta." });
      return;
    }
    const settings = await getSettings();
    res.json({ data: await askAssistant(req, turns, settings.companyName || "produtora") });
  } catch (error) {
    if (error instanceof AssistantUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(503).json({ error: "A chave da Anthropic configurada em Integrações é inválida." });
      return;
    }
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "O assistente está com muitos pedidos agora. Tente de novo em instantes." });
      return;
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`[assistente] erro ${error.status}: ${error.message}`);
      res.status(502).json({ error: "O assistente não respondeu agora. Tente de novo." });
      return;
    }
    next(error);
  }
}
