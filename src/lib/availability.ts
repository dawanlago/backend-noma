/**
 * Horários livres para o agendamento externo. Tudo em horário de Brasília (UTC−3, sem horário de verão
 * desde 2019); internamente os instantes são milissegundos UTC.
 */
export const TZ_OFFSET_MINUTES = -180;

export interface WeeklyWindow {
  /** 0 = domingo ... 6 = sábado */
  weekday: number;
  /** "HH:MM" */
  start: string;
  end: string;
}

export interface Interval {
  start: number;
  end: number;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" + "HH:MM" em Brasília → instante UTC (ms). */
export function toInstant(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - TZ_OFFSET_MINUTES * 60_000;
}

/** Instante UTC → data, hora e dia da semana em Brasília. */
export function localParts(instant: number) {
  const local = new Date(instant + TZ_OFFSET_MINUTES * 60_000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
    weekday: local.getUTCDay(),
  };
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export interface SlotOptions {
  /** Janela pesquisada (ms UTC). */
  from: number;
  to: number;
  windows: WeeklyWindow[];
  durationMinutes: number;
  /** Folga antes e depois de cada compromisso. */
  bufferMinutes?: number;
  /** Intervalo entre inícios (padrão: a própria duração). */
  stepMinutes?: number;
  /** Ocupado: compromissos, reservas, Google Agenda e bloqueios manuais. */
  busy: Interval[];
}

/** Horários de início livres entre `from` e `to`, respeitando as janelas da semana e o que está ocupado. */
export function computeSlots(options: SlotOptions): Interval[] {
  const duration = options.durationMinutes * 60_000;
  const buffer = (options.bufferMinutes || 0) * 60_000;
  const step = (options.stepMinutes || options.durationMinutes) * 60_000;
  if (duration <= 0 || step <= 0) return [];
  const busy = options.busy.map((item) => ({ start: item.start - buffer, end: item.end + buffer }));
  const slots: Interval[] = [];
  const firstDay = localParts(options.from).date;
  for (let dayStart = toInstant(firstDay, "00:00"); dayStart < options.to; dayStart += DAY) {
    const { date, weekday } = localParts(dayStart);
    for (const window of options.windows.filter((item) => item.weekday === weekday)) {
      const windowEnd = toInstant(date, window.end);
      for (let start = toInstant(date, window.start); start + duration <= windowEnd; start += step) {
        const slot = { start, end: start + duration };
        if (start < options.from || start >= options.to) continue;
        if (busy.some((item) => overlaps(item, slot))) continue;
        slots.push(slot);
      }
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

/** Janela padrão: segunda a sexta, 9h–12h e 14h–18h. */
export const DEFAULT_WINDOWS: WeeklyWindow[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: "09:00", end: "12:00" },
  { weekday, start: "14:00", end: "18:00" },
]);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida as janelas vindas do formulário. */
export function sanitizeWindows(value: unknown): WeeklyWindow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Record<string, unknown>)
    .filter((item) => Number.isInteger(item.weekday) && Number(item.weekday) >= 0 && Number(item.weekday) <= 6)
    .filter((item) => TIME_RE.test(String(item.start)) && TIME_RE.test(String(item.end)) && String(item.start) < String(item.end))
    .map((item) => ({ weekday: Number(item.weekday), start: String(item.start), end: String(item.end) }))
    .slice(0, 50);
}
