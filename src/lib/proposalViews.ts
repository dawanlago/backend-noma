/* Regras do rastreio de visualização do link público das propostas. */

export type ViewDevice = "mobile" | "tablet" | "desktop" | "unknown";

/** Uma sessão nunca conta mais que isso (aba esquecida aberta não vira "8h lendo"). */
export const MAX_SESSION_SECONDS = 4 * 60 * 60;
/** Heartbeats de uma sessão mais antiga que isso são ignorados. */
export const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Folga para relógio/rede ao comparar o tempo informado com o tempo real decorrido. */
const CLOCK_SLACK_SECONDS = 10;
/** Limite de sessões novas por link numa hora (evita inflar o contador com recarregamentos em massa). */
export const MAX_VIEWS_PER_HOUR = 60;

export function summarizeUserAgent(raw: unknown): { device: ViewDevice; os: string; browser: string } {
  const ua = typeof raw === "string" ? raw : "";
  if (!ua) return { device: "unknown", os: "", browser: "" };

  let os = "";
  if (/iPad|iPhone|iPod/.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let device: ViewDevice = "desktop";
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/i.test(ua)) device = "mobile";
  else if (!os) device = "unknown";

  // A ordem importa: navegadores embutidos e derivados do Chrome vêm antes do Chrome.
  const browsers: [RegExp, string][] = [
    [/Instagram/i, "Instagram"],
    [/FBAN|FBAV|FB_IAB/i, "Facebook"],
    [/WhatsApp/i, "WhatsApp"],
    [/LinkedInApp/i, "LinkedIn"],
    [/Edg(e|A|iOS)?\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/SamsungBrowser/i, "Samsung Internet"],
    [/Firefox|FxiOS/, "Firefox"],
    [/Chrome|CriOS/, "Chrome"],
    [/Safari/, "Safari"],
  ];
  const browser = browsers.find(([pattern]) => pattern.test(ua))?.[1] || "";
  return { device, os, browser };
}

/**
 * Tempo de visualização aceito para a sessão: nunca maior que o tempo real desde a abertura
 * nem que o teto por sessão. `null` = valor inválido (ignorar).
 */
export function clampDuration(reported: unknown, openedAt: Date, now = new Date()): number | null {
  const seconds = Number(reported);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const elapsed = Math.max(0, (now.getTime() - openedAt.getTime()) / 1000);
  return Math.floor(Math.min(seconds, elapsed + CLOCK_SLACK_SECONDS, MAX_SESSION_SECONDS));
}

/** O `navigator.sendBeacon` manda texto puro; as demais chamadas mandam JSON. */
export function parseBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  if (typeof body === "string" && body.length <= 2000) {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}
