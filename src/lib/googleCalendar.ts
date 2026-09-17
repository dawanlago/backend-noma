import { google } from "googleapis";
import { env } from "../config/env";
import GoogleConnection from "../models/GoogleConnection";

function createOAuthClient() {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export async function getGoogleCalendarStatus() {
  const connection = await GoogleConnection.findOne({ provider: "google_calendar" });
  const envConfigured = Boolean(env.googleCalendarRefreshToken && env.googleClientId && env.googleClientSecret);

  return {
    configured: Boolean(env.googleClientId && env.googleClientSecret),
    connected: Boolean(connection?.refreshToken) || envConfigured,
    calendarId: connection?.calendarId || env.googleCalendarId,
    connectedEmail: connection?.connectedEmail || "",
    connectedAt: connection?.connectedAt || null,
    source: connection?.refreshToken ? "oauth" : envConfigured ? "env" : "none",
  };
}

export async function getCalendarCredentials() {
  if (!env.googleClientId || !env.googleClientSecret) {
    return null;
  }

  const connection = await GoogleConnection.findOne({ provider: "google_calendar" });
  const refreshToken = connection?.refreshToken || env.googleCalendarRefreshToken;
  if (!refreshToken) {
    return null;
  }

  return {
    refreshToken,
    calendarId: connection?.calendarId || env.googleCalendarId || "primary",
  };
}

export function getGoogleAuthUrl() {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new Error("Google Calendar não está configurado (CLIENT_ID/SECRET).");
  }

  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/userinfo.email"],
  });
}

export async function connectGoogleCalendar(code: string, userId?: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google não retornou refresh token. Revogue o acesso e conecte novamente.");
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get().catch(() => null);

  const connection = await GoogleConnection.findOneAndUpdate(
    { provider: "google_calendar" },
    {
      provider: "google_calendar",
      refreshToken: tokens.refresh_token,
      calendarId: env.googleCalendarId || "primary",
      connectedEmail: profile?.data.email || "",
      connectedBy: userId,
      connectedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return connection;
}

export async function disconnectGoogleCalendar() {
  await GoogleConnection.deleteOne({ provider: "google_calendar" });
}

async function getCalendarClient() {
  const credentials = await getCalendarCredentials();
  if (!credentials) {
    return null;
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });

  return {
    calendar: google.calendar({ version: "v3", auth: oauth2Client }),
    calendarId: credentials.calendarId,
  };
}

function eventBody(params: {
  contactName: string;
  contactEmail: string;
  dealTitle: string;
  startDate: Date;
  dossieLink: string;
  title?: string;
  description?: string;
}) {
  const endDate = new Date(params.startDate.getTime() + 60 * 60 * 1000);
  return {
    summary: params.title || `Reunião — ${params.dealTitle}`,
    description:
      params.description ||
      `Contato: ${params.contactName}\nE-mail: ${params.contactEmail}\nDossiê: ${params.dossieLink}`,
    start: { dateTime: params.startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
  };
}

export async function createAgendaEvent(params: {
  contactName: string;
  contactEmail: string;
  dealTitle: string;
  startDate: Date;
  dossieLink: string;
  title?: string;
  description?: string;
}) {
  const client = await getCalendarClient();
  if (!client) {
    console.log("[calendar:skipped] Google Calendar não configurado.");
    return null;
  }

  const event = await client.calendar.events.insert({
    calendarId: client.calendarId,
    requestBody: eventBody(params),
  });

  console.log(`[calendar:created] Evento ${event.data.id || "sem-id"} criado.`);
  return event.data;
}

export async function updateAgendaEvent(
  eventId: string,
  params: {
    contactName: string;
    contactEmail: string;
    dealTitle: string;
    startDate: Date;
    dossieLink: string;
    title?: string;
    description?: string;
  },
) {
  const client = await getCalendarClient();
  if (!client) {
    console.log("[calendar:skipped] Google Calendar não configurado.");
    return null;
  }

  const event = await client.calendar.events.update({
    calendarId: client.calendarId,
    eventId,
    requestBody: eventBody(params),
  });

  console.log(`[calendar:updated] Evento ${eventId} atualizado.`);
  return event.data;
}

export async function deleteAgendaEvent(eventId: string) {
  const client = await getCalendarClient();
  if (!client) {
    return false;
  }

  await client.calendar.events.delete({
    calendarId: client.calendarId,
    eventId,
  });

  console.log(`[calendar:deleted] Evento ${eventId} removido.`);
  return true;
}

export async function syncTaskToGoogle(params: {
  title: string;
  description?: string;
  dueDate: Date;
  googleEventId?: string;
  contactName: string;
  contactEmail: string;
  dealTitle: string;
  dossieLink: string;
}) {
  const payload = {
    contactName: params.contactName,
    contactEmail: params.contactEmail,
    dealTitle: params.dealTitle,
    startDate: params.dueDate,
    dossieLink: params.dossieLink,
    title: params.title,
    description: params.description,
  };

  if (params.googleEventId) {
    const event = await updateAgendaEvent(params.googleEventId, payload);
    return event?.id || params.googleEventId;
  }

  const event = await createAgendaEvent(payload);
  return event?.id || null;
}
