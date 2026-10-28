import Anthropic from "@anthropic-ai/sdk";
import { findIntegration, secret } from "./integrations";

/**
 * Textos escritos pela IA (Claude). A chave vem de Configurações → Integrações (por empresa)
 * ou, sem ela, de ANTHROPIC_API_KEY no servidor. Sem chave, ou se a IA falhar, quem chama
 * usa o texto padrão: a IA nunca impede o fluxo.
 */
const DEFAULT_MODEL = "claude-opus-5-5";
/** Modelos que aceitam o fallback do servidor ("default") quando a IA recusa um pedido. */
const FALLBACK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];

async function aiClient() {
  const integration = await findIntegration("anthropic");
  if (integration && !integration.enabled) return null;
  const apiKey = secret(integration, "apiKey") || process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) return null;
  const config = integration?.config || {};
  return {
    client: new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 }),
    model: typeof config.model === "string" && config.model ? config.model : DEFAULT_MODEL,
    bookingPrompt: typeof config.bookingPrompt === "string" ? config.bookingPrompt.trim() : "",
  };
}

export interface BookingMessageInput {
  /** Texto padrão (template já preenchido): base para a IA e resposta se ela não estiver disponível. */
  fallbackText: string;
  companyName: string;
  firstName: string;
  title: string;
  date: string;
  time: string;
  location?: string;
  notes?: string;
  channel: "whatsapp" | "email";
}

/** Mensagem de confirmação de reunião agendada pelo lead. */
export async function bookingConfirmationText(input: BookingMessageInput): Promise<string> {
  const ai = await aiClient().catch(() => null);
  if (!ai) return input.fallbackText;
  const system = [
    `Você escreve, em português do Brasil, a mensagem de confirmação de uma reunião marcada com a ${input.companyName}, uma produtora audiovisual.`,
    input.channel === "whatsapp"
      ? "A mensagem vai pelo WhatsApp: curta (até 5 linhas), calorosa, sem markdown além de *negrito* pontual, no máximo um emoji."
      : "A mensagem vai por e-mail: texto simples, sem markdown, de 3 a 6 linhas, com saudação e despedida.",
    "Inclua obrigatoriamente o nome da reunião, a data e o horário exatamente como informados, e o local se houver. Não invente links, preços, nomes de pessoas nem informações que não foram dadas.",
    "Responda só com o texto da mensagem, sem comentários.",
    ai.bookingPrompt ? `Orientações da produtora: ${ai.bookingPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const details = [
    `Nome do cliente: ${input.firstName}`,
    `Reunião: ${input.title}`,
    `Data: ${input.date}`,
    `Horário: ${input.time} (horário de Brasília)`,
    input.location ? `Local: ${input.location}` : "",
    input.notes ? `O cliente escreveu: ${input.notes.slice(0, 500)}` : "",
    `Texto padrão da produtora (use como referência de conteúdo): ${input.fallbackText}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await ai.client.beta.messages.create({
      model: ai.model,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: details }],
      ...(FALLBACK_MODELS.includes(ai.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") return input.fallbackText;
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    // Resposta vazia ou sem a data/hora: fica com o texto padrão.
    return text && text.includes(input.time) ? text : input.fallbackText;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error("[ia] chave da Anthropic inválida");
    else if (error instanceof Anthropic.RateLimitError) console.error("[ia] limite de uso da Anthropic");
    else if (error instanceof Anthropic.APIError) console.error(`[ia] erro ${error.status}: ${error.message}`);
    else console.error("[ia]", error instanceof Error ? error.message : error);
    return input.fallbackText;
  }
}
