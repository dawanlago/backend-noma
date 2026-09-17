import axios from "axios";
import { env } from "../config/env";

const SYSTEM_PROMPT = `Você monta dossiês comerciais em português para reunião de fechamento.

Regras:
- Não escreva introdução, saudação, conclusão nem linhas com ---.
- Não invente dados. Se faltar informação, escreva "Não informado".
- Use markdown exatamente neste formato:

## Lead
- **Nome:** ...
- **Empresa:** ...
- **E-mail:** ...
- **Telefone:** ...
- **Responsável:** ...

## Necessidades
- ...

## Problemas
- ...

## Objetivos
- ...

## Interesses
- **Serviço:** ...
- **Valor:** ...

## Histórico
- **Origem:** ...
- **Etapa:** ...
- **Relacionamento:** ...

## Pontos de atenção
- ...

## Recomendações
- ...`;

export function isAiConfigured() {
  if (env.aiProvider === "gemini") return Boolean(env.geminiApiKey);
  if (env.aiProvider === "groq") return Boolean(env.groqApiKey);
  return Boolean(env.openaiApiKey);
}

function providerLabel() {
  if (env.aiProvider === "gemini") return "Gemini";
  if (env.aiProvider === "groq") return "Groq";
  return "OpenAI";
}

function extractApiMessage(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : "";
  }

  const payload = error.response?.data as { error?: { message?: string; status?: string } | string } | undefined;
  const nested = payload?.error;
  if (typeof nested === "string") return nested.trim();
  return String(nested?.message || nested?.status || "").trim();
}

function isCapacityError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === 401 || status === 403) return false;
  const message = extractApiMessage(error);
  if (/quota|billing|insufficient.?credit/i.test(message) && !/high demand/i.test(message)) {
    return false;
  }
  return (
    status === 503 ||
    status === 500 ||
    /high demand|try again later|unavailable|overloaded|currently experiencing/i.test(message)
  );
}

function apiFailureMessage(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : "Não foi possível gerar o dossiê com a IA.";
  }

  const status = error.response?.status;
  const apiMessage = extractApiMessage(error);

  if (status === 401 || status === 403) {
    return `A chave da ${providerLabel()} é inválida. Gere outra e atualize o .env.`;
  }

  if (isCapacityError(error)) {
    return "O Gemini está com alta demanda agora. O Noma já tentou outro modelo; espere um minuto e gere de novo.";
  }

  if (status === 429) {
    if (/quota|billing|credit/i.test(apiMessage)) {
      return `A cota gratuita da ${providerLabel()} acabou. Espere um pouco ou use outra chave.`;
    }
    return `A ${providerLabel()} recusou o pedido por limite de uso. Espere um minuto e tente de novo.`;
  }

  return apiMessage || "Não foi possível gerar o dossiê com a IA.";
}

function geminiModelsToTry() {
  const preferred = env.geminiModel;
  return [preferred, "gemini-3.5-flash", "gemini-2.5-flash"].filter(
    (model, index, list) => Boolean(model) && list.indexOf(model) === index,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithGeminiModel(prompt: string, model: string) {
  const { data } = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      model,
      input: prompt,
      system_instruction: SYSTEM_PROMPT,
      generation_config: { temperature: 0.3 },
      store: false,
    },
    {
      headers: {
        "x-goog-api-key": env.geminiApiKey,
        "Content-Type": "application/json",
        "Api-Revision": "2026-05-20",
      },
      timeout: 45000,
    },
  );

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const summary = steps
    .filter((step: { type?: string }) => step.type === "model_output")
    .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
    .filter((part: { type?: string; text?: string }) => part.type === "text" && part.text)
    .map((part: { text?: string }) => part.text)
    .join("\n")
    .trim();

  if (!summary) {
    throw new Error("A IA não retornou um resumo.");
  }

  return { summary, model: data?.model || model };
}

async function generateWithGemini(prompt: string) {
  let lastError: unknown;

  for (const [index, model] of geminiModelsToTry().entries()) {
    try {
      return await generateWithGeminiModel(prompt, model);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === "A IA não retornou um resumo.") {
        throw error;
      }
      if (!isCapacityError(error)) {
        throw error;
      }
      if (index === 0) {
        await sleep(1200);
        try {
          return await generateWithGeminiModel(prompt, model);
        } catch (retryError) {
          lastError = retryError;
          if (!isCapacityError(retryError)) {
            throw retryError;
          }
        }
      }
    }
  }

  throw lastError;
}

async function generateWithOpenAiCompatible(
  prompt: string,
  options: { url: string; apiKey: string; model: string },
) {
  const { data } = await axios.post(
    options.url,
    {
      model: options.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 45000,
    },
  );

  const summary = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!summary) {
    throw new Error("A IA não retornou um resumo.");
  }

  return { summary, model: options.model };
}

export async function generateDossierSummary(prompt: string) {
  if (!isAiConfigured()) {
    throw new Error("IA não configurada. Defina GEMINI_API_KEY (gratuita) no .env.");
  }

  try {
    if (env.aiProvider === "gemini") {
      return await generateWithGemini(prompt);
    }

    if (env.aiProvider === "groq") {
      return await generateWithOpenAiCompatible(prompt, {
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: env.groqApiKey,
        model: env.groqModel,
      });
    }

    return await generateWithOpenAiCompatible(prompt, {
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: env.openaiApiKey,
      model: env.openaiModel,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "A IA não retornou um resumo.") {
      throw error;
    }
    throw new Error(apiFailureMessage(error));
  }
}
