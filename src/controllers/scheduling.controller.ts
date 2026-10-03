import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { computeSlots, DEFAULT_WINDOWS, localParts, overlaps, sanitizeWindows, toInstant, type Interval } from "../lib/availability";
import { emailConfigured, sendMail } from "../lib/email";
import { googleBusy, syncTask } from "../lib/googleCalendar";
import { notify } from "../lib/notifications";
import { recordScope } from "../lib/ownership";
import { phoneKey } from "../lib/phone";
import { getSettings } from "../lib/seedDefaults";
import { acrossOrgs } from "../lib/tenant";
import Booking from "../models/Booking";
import Contact from "../models/Contact";
import Lead from "../models/Lead";
import SchedulingLink, { type ISchedulingLink } from "../models/SchedulingLink";
import Task from "../models/Task";
import User from "../models/User";

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_CONFIRMATION =
  "Olá, {nome}! Sua reunião \"{titulo}\" está confirmada para {data} às {hora} (horário de Brasília).{local}\n\nAté lá!";

function newSlug() {
  return crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase();
}

/** Copia os campos editáveis do formulário para o link. */
function applyLink(link: ISchedulingLink, body: Record<string, unknown>) {
  for (const key of ["title", "description", "location", "confirmationMessage"] as const) {
    if (typeof body[key] === "string") link[key] = (body[key] as string).trim();
  }
  const clamp = (value: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value))));
  if (body.durationMinutes !== undefined) link.durationMinutes = clamp(body.durationMinutes, 10, 480);
  if (body.bufferMinutes !== undefined) link.bufferMinutes = clamp(body.bufferMinutes, 0, 240);
  if (body.minNoticeHours !== undefined) link.minNoticeHours = clamp(body.minNoticeHours, 0, 24 * 60);
  if (body.horizonDays !== undefined) link.horizonDays = clamp(body.horizonDays, 1, 180);
  if (body.windows !== undefined) link.windows = sanitizeWindows(body.windows);
  if (Array.isArray(body.blocks)) {
    link.set(
      "blocks",
      body.blocks
        .map((item) => item as Record<string, unknown>)
        .map((item) => ({ start: new Date(String(item.start)), end: new Date(String(item.end)), note: String(item.note || "").trim() }))
        .filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()) && item.end > item.start)
        .slice(0, 200),
    );
  }
  if (typeof body.isActive === "boolean") link.isActive = body.isActive;
}

/**
 * Ocupado na agenda da pessoa entre `from` e `to`: compromissos com hora (em qualquer empresa),
 * reuniões já marcadas, bloqueios do link e o Google Agenda.
 */
export async function ownerBusy(ownerId: string, from: number, to: number, link?: ISchedulingLink | null) {
  const firstDate = localParts(from - DAY).date;
  const lastDate = localParts(to + DAY).date;
  const [tasks, bookings, google] = await Promise.all([
    acrossOrgs(() =>
      Task.find({ ownerId, done: false, time: { $ne: "" }, dueDate: { $gte: firstDate, $lte: lastDate } })
        .select("title dueDate time duration")
        .lean()
        .exec(),
    ),
    acrossOrgs(() => Booking.find({ ownerId, status: "confirmed", start: { $lt: new Date(to) }, end: { $gt: new Date(from) } }).select("start end").lean().exec()),
    googleBusy(ownerId, new Date(from), new Date(to)),
  ]);
  const intervals: (Interval & { source: string; title?: string })[] = [
    ...tasks.map((task) => {
      const start = toInstant(task.dueDate, task.time);
      return { start, end: start + (task.duration || 60) * 60_000, source: "noma", title: task.title };
    }),
    ...bookings.map((item) => ({ start: item.start.getTime(), end: item.end.getTime(), source: "reserva" })),
    ...(link?.blocks || []).map((item) => ({ start: item.start.getTime(), end: item.end.getTime(), source: "bloqueio", title: item.note })),
    ...google.intervals.map((item) => ({ ...item, source: "google" })),
  ];
  return { intervals, google: google.status };
}

/** Horários livres de um link entre `from` e `to` (ms UTC). */
async function linkSlots(link: ISchedulingLink, from: number, to: number) {
  const earliest = Math.max(from, Date.now() + link.minNoticeHours * 3_600_000);
  const latest = Math.min(to, Date.now() + link.horizonDays * DAY);
  if (earliest >= latest) return { slots: [], google: "ok" };
  const busy = await ownerBusy(String(link.ownerId), earliest, latest, link);
  const slots = computeSlots({
    from: earliest,
    to: latest,
    windows: link.windows.length ? link.windows : DEFAULT_WINDOWS,
    durationMinutes: link.durationMinutes,
    bufferMinutes: link.bufferMinutes,
    busy: busy.intervals,
  });
  return { slots, google: busy.google };
}

// ---------- interno (logado) ----------

/** GET /scheduling/links — links de quem está logado (o admin vê os de todos). */
export async function listLinks(req: Request, res: Response, next: NextFunction) {
  try {
    const filter = req.user!.role === "admin" ? {} : { ownerId: req.user!._id };
    res.json({ data: await SchedulingLink.find(filter).sort({ createdAt: -1 }).lean() });
  } catch (error) {
    next(error);
  }
}

export async function createLink(req: Request, res: Response, next: NextFunction) {
  try {
    const link = new SchedulingLink({ ownerId: req.user!._id, slug: newSlug(), windows: DEFAULT_WINDOWS, confirmationMessage: DEFAULT_CONFIRMATION });
    applyLink(link, req.body);
    await link.save();
    res.status(201).json({ data: link.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateLink(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await SchedulingLink.findOne({ _id: req.params.id, ...recordScope(req) });
    if (!link) {
      res.status(404).json({ error: "Link de agendamento não encontrado." });
      return;
    }
    applyLink(link, req.body);
    await link.save();
    res.json({ data: link.toJSON() });
  } catch (error) {
    next(error);
  }
}

export async function deleteLink(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await SchedulingLink.findOneAndDelete({ _id: req.params.id, ...recordScope(req) });
    if (!link) {
      res.status(404).json({ error: "Link de agendamento não encontrado." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * GET /scheduling/busy?date=YYYY-MM-DD[&days=1] — o que já está marcado na agenda de quem está logado
 * (para ver a agenda na hora de marcar um compromisso).
 */
export async function myBusy(req: Request, res: Response, next: NextFunction) {
  try {
    const date = typeof req.query.date === "string" && DATE_RE.test(req.query.date) ? req.query.date : localParts(Date.now()).date;
    const days = Math.min(14, Math.max(1, Number(req.query.days) || 1));
    const from = toInstant(date, "00:00");
    const busy = await ownerBusy(String(req.user!._id), from, from + days * DAY);
    res.json({
      data: {
        google: busy.google,
        items: busy.intervals
          .filter((item) => item.end > from && item.start < from + days * DAY)
          .sort((a, b) => a.start - b.start)
          .map((item) => ({
            start: new Date(item.start).toISOString(),
            end: new Date(item.end).toISOString(),
            source: item.source,
            title: item.source === "google" ? "Ocupado (Google Agenda)" : item.title || (item.source === "reserva" ? "Reunião agendada" : "Bloqueado"),
          })),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /scheduling/bookings — próximas reuniões marcadas pelo link. */
export async function listBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const filter = req.user!.role === "admin" ? {} : { ownerId: req.user!._id };
    const data = await Booking.find({ ...filter, start: { $gte: new Date(Date.now() - DAY) } }).sort({ start: 1 }).limit(200).lean();
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

/** POST /scheduling/bookings/:id/cancel — libera o horário e conclui o compromisso. */
export async function cancelBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, ...recordScope(req), status: "confirmed" });
    if (!booking) {
      res.status(404).json({ error: "Reunião não encontrada." });
      return;
    }
    booking.status = "cancelled";
    await booking.save();
    if (booking.taskId) {
      const task = await Task.findById(booking.taskId);
      if (task) {
        task.title = `Cancelada: ${task.title.replace(/^Cancelada: /, "")}`;
        task.status = "done";
        await task.save();
        await syncTask(task);
      }
    }
    res.json({ data: booking.toJSON() });
  } catch (error) {
    next(error);
  }
}

// ---------- público (o lead) ----------

async function publicLink(slug: string) {
  const link = await SchedulingLink.findOne({ slug, isActive: true });
  return link;
}

/** GET /public/schedule/:slug?from=YYYY-MM-DD&days=14 — dados do link e horários livres. */
export async function getPublicSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await publicLink(req.params.slug);
    if (!link) {
      res.status(404).json({ error: "Este link de agendamento não está disponível." });
      return;
    }
    const today = localParts(Date.now()).date;
    const fromDate = typeof req.query.from === "string" && DATE_RE.test(req.query.from) && req.query.from >= today ? req.query.from : today;
    const days = Math.min(31, Math.max(1, Number(req.query.days) || 14));
    const from = toInstant(fromDate, "00:00");
    const [owner, settings, result] = await Promise.all([
      User.findById(link.ownerId).select("name").lean(),
      getSettings(),
      linkSlots(link, from, from + days * DAY),
    ]);
    res.json({
      data: {
        title: link.title,
        description: link.description,
        location: link.location,
        durationMinutes: link.durationMinutes,
        horizonDays: link.horizonDays,
        ownerName: owner?.name || "",
        brand: { companyName: settings.companyName, logo: settings.brand?.logo || "", color: settings.brand?.defaultColor || "" },
        from: fromDate,
        slots: result.slots.map((slot) => new Date(slot.start).toISOString()),
      },
    });
  } catch (error) {
    next(error);
  }
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}

/** Contato do lead (pelo telefone, depois e-mail) e a negociação em aberto dele, se houver. */
async function findOrCreateContact(name: string, email: string, phone: string) {
  const key = phoneKey(phone);
  let contact = key ? await Contact.findOne({ phoneKey: key }) : null;
  if (!contact && email) contact = await Contact.findOne({ email });
  if (!contact) contact = await Contact.create({ name, email, phone, kinds: ["lead"] });
  else {
    if (!contact.email && email) contact.email = email;
    if (!contact.phone && phone) contact.phone = phone;
    if (contact.isModified()) await contact.save();
  }
  const lead = await Lead.findOne({ contactId: contact._id, status: "open" }).sort({ updatedAt: -1 });
  return { contact, lead };
}

/** POST /public/schedule/:slug/book { start, name, email, phone, notes } */
export async function bookPublicSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await publicLink(req.params.slug);
    if (!link) {
      res.status(404).json({ error: "Este link de agendamento não está disponível." });
      return;
    }
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 160);
    const phone = String(req.body?.phone || "").trim().slice(0, 40);
    const notes = String(req.body?.notes || "").trim().slice(0, 2000);
    const start = Date.parse(String(req.body?.start || ""));
    if (!name || (!email && !phone) || Number.isNaN(start)) {
      res.status(400).json({ error: "Informe seu nome, um contato (e-mail ou WhatsApp) e o horário." });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      res.status(400).json({ error: "E-mail inválido." });
      return;
    }
    // Confere de novo, na hora, que o horário continua livre.
    const end = start + link.durationMinutes * 60_000;
    const { slots } = await linkSlots(link, start - DAY, start + DAY);
    if (!slots.some((slot) => slot.start === start)) {
      res.status(409).json({ error: "Este horário acabou de ser ocupado. Escolha outro, por favor." });
      return;
    }
    let booking;
    try {
      booking = await Booking.create({ linkId: link._id, ownerId: link.ownerId, start: new Date(start), end: new Date(end), name, email, phone, notes });
    } catch (error) {
      // Índice único: outra pessoa reservou o mesmo horário no mesmo instante.
      if ((error as { code?: number }).code === 11000) {
        res.status(409).json({ error: "Este horário acabou de ser ocupado. Escolha outro, por favor." });
        return;
      }
      throw error;
    }
    // Por segurança contra corrida com compromissos de outras fontes, confere sobreposição com outra reserva.
    const clash = await acrossOrgs(() =>
      Booking.findOne({ _id: { $ne: booking._id }, ownerId: link.ownerId, status: "confirmed", start: { $lt: new Date(end) }, end: { $gt: new Date(start) } }).lean().exec(),
    );
    if (clash && overlaps({ start, end }, { start: clash.start.getTime(), end: clash.end.getTime() })) {
      await booking.deleteOne();
      res.status(409).json({ error: "Este horário acabou de ser ocupado. Escolha outro, por favor." });
      return;
    }

    const { contact, lead } = await findOrCreateContact(name, email, phone);
    const local = localParts(start);
    const task = await Task.create({
      ownerId: link.ownerId,
      title: `${link.title}: ${name}`,
      type: "meeting",
      dueDate: local.date,
      time: local.time,
      duration: link.durationMinutes,
      leadId: lead?._id,
      notes: [notes, `Agendado pelo link (${email || phone}).`, link.location ? `Local: ${link.location}` : ""].filter(Boolean).join("\n"),
    });
    booking.taskId = task._id;
    booking.contactId = contact._id;
    booking.leadId = lead?._id;
    await booking.save();
    if (lead) {
      lead.history.push({ at: new Date(), text: `Reunião agendada pelo cliente para ${local.date.split("-").reverse().join("/")} às ${local.time}`, userName: name });
      await lead.save();
    }
    await syncTask(task);
    await notify([link.ownerId], {
      type: "booking",
      title: `Reunião agendada: ${name}`,
      body: `${link.title} · ${local.date.split("-").reverse().join("/")} às ${local.time}`,
      link: lead ? `/crm/${lead._id}` : "/agenda",
    });

    const values = {
      nome: name.split(" ")[0],
      titulo: link.title,
      data: local.date.split("-").reverse().join("/"),
      hora: local.time,
      local: link.location ? `\nLocal: ${link.location}` : "",
    };
    if (emailConfigured()) {
      const owner = await User.findById(link.ownerId).select("name email").lean();
      const jobs: Promise<unknown>[] = [];
      if (email) {
        jobs.push(
          sendMail({
            to: email,
            subject: `Reunião confirmada: ${values.data} às ${values.hora}`,
            text: fillTemplate(link.confirmationMessage || DEFAULT_CONFIRMATION, values),
            replyTo: owner?.email,
          }),
        );
      }
      if (owner?.email) {
        jobs.push(
          sendMail({
            to: owner.email,
            subject: `Nova reunião agendada: ${name} · ${values.data} ${values.hora}`,
            text: `${name} marcou "${link.title}" para ${values.data} às ${values.hora}.\nContato: ${[email, phone].filter(Boolean).join(" · ")}${notes ? `\n\n${notes}` : ""}`,
          }),
        );
      }
      // Falha no e-mail não desfaz a reunião.
      await Promise.allSettled(jobs);
    }
    res.status(201).json({ data: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), title: link.title, location: link.location } });
  } catch (error) {
    next(error);
  }
}

export const isSchedulingId = (value: unknown) => isValidObjectId(value);
