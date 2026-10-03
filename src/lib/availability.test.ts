import { describe, expect, it } from "vitest";
import { computeSlots, localParts, sanitizeWindows, toInstant } from "./availability";

describe("agendamento: horários livres", () => {
  // 2026-10-05 é segunda-feira.
  const monday = "2026-10-05";
  const windows = [{ weekday: 1, start: "09:00", end: "11:00" }];

  it("converte horário de Brasília e volta", () => {
    const instant = toInstant(monday, "09:30");
    expect(new Date(instant).toISOString()).toBe("2026-10-05T12:30:00.000Z");
    expect(localParts(instant)).toEqual({ date: monday, time: "09:30", weekday: 1 });
  });

  it("gera inícios dentro da janela, sem passar do fim", () => {
    const slots = computeSlots({ from: toInstant(monday, "00:00"), to: toInstant("2026-10-06", "00:00"), windows, durationMinutes: 45, busy: [] });
    expect(slots.map((slot) => localParts(slot.start).time)).toEqual(["09:00", "09:45"]);
  });

  it("tira o que está ocupado, com folga", () => {
    const busy = [{ start: toInstant(monday, "10:00"), end: toInstant(monday, "10:30") }];
    const slots = computeSlots({ from: toInstant(monday, "00:00"), to: toInstant("2026-10-06", "00:00"), windows, durationMinutes: 30, bufferMinutes: 15, busy });
    // Ocupado 10:00–10:30 com 15 min de folga bloqueia 09:45–10:45: sobra só 09:00.
    expect(slots.map((slot) => localParts(slot.start).time)).toEqual(["09:00"]);
  });

  it("respeita a antecedência mínima (from) e outros dias da semana", () => {
    const slots = computeSlots({ from: toInstant(monday, "09:10"), to: toInstant("2026-10-13", "00:00"), windows, durationMinutes: 60, busy: [] });
    expect(slots.map((slot) => `${localParts(slot.start).date} ${localParts(slot.start).time}`)).toEqual(["2026-10-05 10:00", "2026-10-12 09:00", "2026-10-12 10:00"]);
  });

  it("sanitizeWindows descarta janelas inválidas", () => {
    expect(sanitizeWindows([{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 9, start: "09:00", end: "10:00" }, { weekday: 2, start: "18:00", end: "09:00" }])).toEqual([
      { weekday: 1, start: "09:00", end: "12:00" },
    ]);
  });
});
