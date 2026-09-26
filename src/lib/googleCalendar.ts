import { env } from "../config/env";
import Lead from "../models/Lead";
import type { ITask } from "../models/Task";
import Task from "../models/Task";
import User from "../models/User";
import { open, seal } from "./secretBox";

// Integração com o Google Agenda: cada usuário conecta a própria conta e os compromissos
// com data e hora que ele cria no Noma viram eventos na agenda principal dele (só Noma → Google).

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
export const TIME_ZONE = "America/Sao_Paulo";

export class GoogleAuthRevoked extends Error {}

export function googleConfigured() {
  return Boolean(env.google);
}

export function authorizationUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.google!.clientId,
    redirect_uri: env.google!.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Garante o refresh token mesmo quando a pessoa já autorizou antes.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** E-mail da conta a partir do id_token recebido direto do Google (canal TLS, sem terceiros). */
export function emailFromIdToken(idToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

export async function exchangeCode(code: string) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.google!.clientId,
      client_secret: env.google!.clientSecret,
      redirect_uri: env.google!.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok || !json.refresh_token) throw new Error(json.error_description || json.error || "Falha ao autorizar no Google.");
  return { refreshToken: json.refresh_token, email: emailFromIdToken(json.id_token || "") };
}

export async function connectUser(userId: string, refreshToken: string, email: string) {
  await User.updateOne({ _id: userId }, { googleRefreshToken: seal(refreshToken), googleEmail: email, googleConnectedAt: new Date() });
  tokenCache.delete(userId);
}

export async function disconnectUser(userId: string) {
  const user = await User.findById(userId).select("+googleRefreshToken");
  if (user?.googleRefreshToken) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(open(user.googleRefreshToken))}`, { method: "POST" });
    } catch {
      // Sem rede: a autorização fica pendente no Google, mas o Noma para de usar.
    }
  }
  await User.updateOne({ _id: userId }, { $unset: { googleRefreshToken: 1, googleConnectedAt: 1 }, googleEmail: "" });
  tokenCache.delete(userId);
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(userId: string): Promise<string | null> {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const user = await User.findById(userId).select("+googleRefreshToken");
  if (!user?.googleRefreshToken || !env.google) return null;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      refresh_token: open(user.googleRefreshToken),
      grant_type: "refresh_token",
    }),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, string | number>;
  if (json.error === "invalid_grant") {
    // A pessoa removeu o acesso na conta Google: desconecta para não tentar de novo.
    await User.updateOne({ _id: userId }, { $unset: { googleRefreshToken: 1, googleConnectedAt: 1 }, googleEmail: "" });
    throw new GoogleAuthRevoked("Acesso ao Google Agenda foi removido.");
  }
  if (!response.ok || !json.access_token) throw new Error(String(json.error_description || json.error || "Falha ao renovar o acesso."));
  const token = String(json.access_token);
  tokenCache.set(userId, { token, expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000 });
  return token;
}

/** Soma minutos a "YYYY-MM-DD" + "HH:MM", devolvendo "YYYY-MM-DDTHH:MM:00" (horário local, sem fuso). */
export function addMinutes(date: string, time: string, minutes: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const value = new Date(Date.UTC(y, m - 1, d, hh, mm) + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:00`;
}

export function shouldSync(task: Pick<ITask, "dueDate" | "time">) {
  return /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) && /^\d{2}:\d{2}$/.test(task.time);
}

export function eventBody(
  task: Pick<ITask, "title" | "notes" | "dueDate" | "time" | "duration" | "done">,
  lead?: { id: string; name: string } | null,
) {
  const lines = [task.notes?.trim(), lead ? `Negociação: ${lead.name}\n${env.frontendUrl.replace(/\/+$/, "")}/crm/${lead.id}` : ""].filter(Boolean);
  return {
    summary: `${task.done ? "✓ " : ""}${task.title}`,
    description: [...lines, "Criado pelo Noma."].join("\n\n"),
    start: { dateTime: `${task.dueDate}T${task.time}:00`, timeZone: TIME_ZONE },
    end: { dateTime: addMinutes(task.dueDate, task.time, task.duration || 60), timeZone: TIME_ZONE },
    source: { title: "Noma", url: env.frontendUrl },
  };
}

async function calendarRequest(token: string, method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Deixa o Google Agenda do responsável igual ao compromisso: cria, atualiza ou remove o evento.
 * Nunca derruba a requisição do Noma; falhas vão para o log.
 */
export async function syncTask(task: ITask): Promise<void> {
  if (!env.google) return;
  try {
    const ownerId = String(task.ownerId);
    const token = await accessToken(ownerId);
    if (!token) return;
    if (!shouldSync(task)) {
      if (task.googleEventId) await removeEvent(ownerId, task.googleEventId, token);
      if (task.googleEventId) await Task.updateOne({ _id: task._id }, { googleEventId: "" });
      return;
    }
    const lead = task.leadId ? await Lead.findById(task.leadId).select("name").lean() : null;
    const body = eventBody(task, lead ? { id: String(lead._id), name: lead.name } : null);
    if (task.googleEventId) {
      const response = await calendarRequest(token, "PATCH", `${EVENTS_URL}/${encodeURIComponent(task.googleEventId)}`, body);
      if (response.ok) return;
      // Evento apagado direto no Google: cria de novo.
      if (response.status !== 404 && response.status !== 410) throw new Error(`Google Agenda respondeu ${response.status}.`);
    }
    const response = await calendarRequest(token, "POST", EVENTS_URL, body);
    const json = (await response.json().catch(() => ({}))) as { id?: string };
    if (!response.ok || !json.id) throw new Error(`Google Agenda respondeu ${response.status}.`);
    await Task.updateOne({ _id: task._id }, { googleEventId: json.id });
    task.googleEventId = json.id;
  } catch (error) {
    console.error("[google-agenda] sincronização:", error instanceof Error ? error.message : error);
  }
}

export async function removeEvent(ownerId: string, eventId: string, knownToken?: string) {
  if (!env.google || !eventId) return;
  try {
    const token = knownToken || (await accessToken(ownerId));
    if (!token) return;
    const response = await calendarRequest(token, "DELETE", `${EVENTS_URL}/${encodeURIComponent(eventId)}`);
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google Agenda respondeu ${response.status}.`);
  } catch (error) {
    console.error("[google-agenda] remoção:", error instanceof Error ? error.message : error);
  }
}

/** Envia de uma vez os compromissos futuros de quem acabou de conectar. */
export async function syncUpcoming(userId: string, today: string) {
  const tasks = await Task.find({ ownerId: userId, dueDate: { $gte: today }, time: { $ne: "" }, done: false }).limit(200);
  for (const task of tasks) await syncTask(task);
  return tasks.length;
}
