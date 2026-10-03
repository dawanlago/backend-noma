import Lead from "../models/Lead";
import Organization from "../models/Organization";
import Task from "../models/Task";
import User from "../models/User";
import { localParts, toInstant } from "./availability";
import { emailConfigured, sendMail } from "./email";
import { notify, orgAdmins } from "./notifications";
import { getSettings } from "./seedDefaults";
import { acrossOrgs, runWithOrg } from "./tenant";

const DAY = 86_400_000;
const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const br = (date: string) => date.split("-").reverse().join("/");

/** Lembretes dos compromissos com hora que começam dentro da antecedência escolhida por cada pessoa. */
async function sendReminders(now: number) {
  const today = localParts(now).date;
  const limit = localParts(now + 7 * DAY).date;
  const tasks = await acrossOrgs(() =>
    Task.find({ done: false, time: { $ne: "" }, dueDate: { $gte: localParts(now - DAY).date, $lte: limit }, remindedAt: { $exists: false } }).lean().exec(),
  );
  if (!tasks.length) return 0;
  const owners = await User.find({ _id: { $in: [...new Set(tasks.map((task) => String(task.ownerId)))] }, isActive: true }).lean();
  const prefsOf = new Map(owners.map((user) => [String(user._id), user.notificationPrefs]));
  let sent = 0;
  for (const task of tasks) {
    const prefs = prefsOf.get(String(task.ownerId));
    const minutes = prefs?.reminderMinutes ?? 60;
    if (!prefs || minutes <= 0) continue;
    const start = toInstant(task.dueDate, task.time);
    // Já passou há mais de 15 min: não lembra mais (evita aviso atrasado depois de uma pausa).
    if (start - minutes * 60_000 > now || start < now - 15 * 60_000) continue;
    const when = task.dueDate === today ? `hoje às ${task.time}` : `${br(task.dueDate)} às ${task.time}`;
    await runWithOrg(String(task.orgId), () =>
      notify([task.ownerId], {
        type: "task_reminder",
        title: `Lembrete: ${task.title}`,
        body: `Começa ${when}.`,
        link: task.leadId ? `/crm/${task.leadId}` : "/agenda",
        email: prefs.emailReminders,
      }),
    );
    await acrossOrgs(() => Task.updateOne({ _id: task._id }, { $set: { remindedAt: new Date(now) } }, { timestamps: false }).exec());
    sent += 1;
  }
  return sent;
}

/** Resumo diário (a partir das 7h de Brasília): atividades de hoje e atrasadas, uma vez por dia por pessoa. */
async function sendDigests(now: number) {
  const { date: today, time } = localParts(now);
  if (time < "07:00") return 0;
  const users = await User.find({ isActive: true, "notificationPrefs.dailyDigest": { $ne: false }, lastDigestDate: { $ne: today } }).lean();
  let sent = 0;
  for (const user of users) {
    const tasks = await acrossOrgs(() => Task.find({ ownerId: user._id, done: false, dueDate: { $ne: "", $lte: today } }).sort({ dueDate: 1, time: 1 }).lean().exec());
    await User.updateOne({ _id: user._id }, { $set: { lastDigestDate: today } }, { timestamps: false });
    if (!tasks.length) continue;
    const overdue = tasks.filter((task) => task.dueDate < today);
    const todays = tasks.filter((task) => task.dueDate === today);
    // Um aviso por empresa (o sino mostra os da empresa aberta).
    const byOrg = new Map<string, typeof tasks>();
    tasks.forEach((task) => byOrg.set(String(task.orgId), [...(byOrg.get(String(task.orgId)) || []), task]));
    for (const [orgId, list] of byOrg) {
      const late = list.filter((task) => task.dueDate < today).length;
      await runWithOrg(orgId, () =>
        notify([user._id], {
          type: late ? "task_overdue" : "task_today",
          title: late ? `${late} atividade${late > 1 ? "s" : ""} atrasada${late > 1 ? "s" : ""}` : `${list.length} atividade${list.length > 1 ? "s" : ""} para hoje`,
          body: list.slice(0, 5).map((task) => `• ${task.title}${task.dueDate < today ? ` (desde ${br(task.dueDate)})` : task.time ? ` às ${task.time}` : ""}`).join("\n"),
          link: "/atividades",
        }),
      );
    }
    if (user.email && emailConfigured() && user.notificationPrefs?.emailReminders !== false) {
      const line = (task: (typeof tasks)[number]) => `• ${task.title}${task.time ? ` às ${task.time}` : ""}${task.dueDate < today ? ` (desde ${br(task.dueDate)})` : ""}`;
      await sendMail({
        to: user.email,
        subject: `Seu dia no Noma: ${todays.length} para hoje${overdue.length ? `, ${overdue.length} atrasada${overdue.length > 1 ? "s" : ""}` : ""}`,
        text: [
          `Olá, ${user.name.split(" ")[0]}!`,
          todays.length ? `Para hoje:\n${todays.map(line).join("\n")}` : "",
          overdue.length ? `Atrasadas:\n${overdue.map(line).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }).catch((error) => console.error("[resumo diário]", error instanceof Error ? error.message : error));
    }
    sent += 1;
  }
  return sent;
}

export interface WeeklyStats {
  created: number;
  open: number;
  openValue: number;
  won: number;
  wonValue: number;
  lost: number;
}

/** Números da semana da empresa atual (últimos 7 dias). */
export async function weeklyStats(now: number): Promise<WeeklyStats> {
  const from = new Date(now - 7 * DAY);
  const [created, open, won, lost] = await Promise.all([
    Lead.countDocuments({ createdAt: { $gte: from } }),
    Lead.find({ status: "open" }).select("value").lean(),
    Lead.find({ status: "won", wonAt: { $gte: from } }).select("value closedValue").lean(),
    Lead.countDocuments({ status: "lost", lostAt: { $gte: from } }),
  ]);
  return {
    created,
    open: open.length,
    openValue: open.reduce((sum, lead) => sum + (lead.value || 0), 0),
    won: won.length,
    wonValue: won.reduce((sum, lead) => sum + (lead.closedValue ?? lead.value ?? 0), 0),
    lost,
  };
}

/** Monta e envia o relatório semanal da empresa atual. */
export async function sendWeeklyReport(now: number, recipients?: string[]) {
  const settings = await getSettings();
  const to = recipients?.length ? recipients : settings.weeklyReport?.recipients?.length ? settings.weeklyReport.recipients : [];
  let list = to;
  if (!list.length) {
    const admins = await User.find({ _id: { $in: await orgAdmins() } }).select("email").lean();
    list = admins.map((admin) => admin.email).filter(Boolean);
  }
  if (!list.length || !emailConfigured()) return false;
  const stats = await weeklyStats(now);
  const period = `${br(localParts(now - 7 * DAY).date)} a ${br(localParts(now).date)}`;
  const rows: [string, string][] = [
    ["Negociações criadas", String(stats.created)],
    ["Negociações em andamento", `${stats.open} (${brl(stats.openValue)})`],
    ["Vendas realizadas", String(stats.won)],
    ["Valor total das vendas", brl(stats.wonValue)],
    ["Negociações perdidas", String(stats.lost)],
  ];
  await sendMail({
    to: list.join(", "),
    subject: `Relatório semanal · ${settings.companyName} · ${period}`,
    text: [`Relatório semanal de ${settings.companyName} (${period})`, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n"),
    html: `<h2 style="font-family:sans-serif">Relatório semanal · ${settings.companyName}</h2><p style="font-family:sans-serif;color:#666">${period}</p><table style="font-family:sans-serif;border-collapse:collapse">${rows
      .map(([label, value]) => `<tr><td style="padding:6px 16px 6px 0;color:#555">${label}</td><td style="padding:6px 0;font-weight:600">${value}</td></tr>`)
      .join("")}</table>`,
  });
  return true;
}

/** Relatórios semanais das empresas cujo dia e hora (Brasília) já chegaram e que ainda não receberam nesta semana. */
async function sendWeeklyReports(now: number) {
  const { weekday, time, date } = localParts(now);
  const orgs = await Organization.find({ isActive: true }).select("_id").lean();
  let sent = 0;
  for (const org of orgs) {
    await runWithOrg(org._id, async () => {
      const settings = await getSettings();
      const cfg = settings.weeklyReport;
      if (!cfg?.enabled || weekday !== cfg.weekday || Number(time.slice(0, 2)) < cfg.hour) return;
      const slotStart = toInstant(date, `${String(cfg.hour).padStart(2, "0")}:00`);
      if (cfg.lastSentAt && cfg.lastSentAt.getTime() >= slotStart) return;
      if (await sendWeeklyReport(now)) {
        settings.set("weeklyReport.lastSentAt", new Date(now));
        await settings.save();
        sent += 1;
      }
    });
  }
  return sent;
}

/** Uma rodada do agendador: lembretes, resumo diário e relatórios semanais. */
export async function runTick(now = Date.now()) {
  const result = { reminders: 0, digests: 0, reports: 0 };
  result.reminders = await sendReminders(now).catch((error) => (console.error("[cron:lembretes]", error), 0));
  result.digests = await sendDigests(now).catch((error) => (console.error("[cron:resumo]", error), 0));
  result.reports = await sendWeeklyReports(now).catch((error) => (console.error("[cron:relatório]", error), 0));
  return result;
}
