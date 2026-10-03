import { describe, expect, it } from "vitest";
import { computeLateCharge, daysBetween, entryTotal, normalizeRules } from "./lateCharge";

describe("financeiro: juros e multa por atraso", () => {
  const rules = normalizeRules({ lateFee: 2, monthlyInterest: 1, graceDays: 0 });

  it("conta dias corridos entre datas, inclusive na virada do mês e do ano", () => {
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-30")).toBe(30);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("sem atraso não cobra nada", () => {
    expect(computeLateCharge(1000, "2026-10-10", "2026-10-10", rules)).toBeNull();
    expect(computeLateCharge(1000, "2026-10-10", "2026-10-05", rules)).toBeNull();
  });

  it("multa fixa + juros pro rata die (mês de 30 dias)", () => {
    // R$ 1.000, 15 dias: multa 2% = 20; juros 1% a.m. × 15/30 = 5.
    expect(computeLateCharge(1000, "2026-10-01", "2026-10-16", rules)).toEqual({ days: 15, fee: 20, interest: 5, total: 25 });
    // 1 dia: juros de 1/30 de 1% sobre 1.500 = 0,50.
    expect(computeLateCharge(1500, "2026-10-01", "2026-10-02", rules)).toEqual({ days: 1, fee: 30, interest: 0.5, total: 30.5 });
  });

  it("arredonda para centavos", () => {
    const charge = computeLateCharge(333.33, "2026-10-01", "2026-10-08", rules)!;
    expect(charge.fee).toBe(6.67);
    expect(charge.interest).toBe(0.78);
    expect(charge.total).toBe(7.45);
  });

  it("dentro da carência não cobra; depois dela conta desde o vencimento", () => {
    const grace = normalizeRules({ lateFee: 2, monthlyInterest: 1, graceDays: 5 });
    expect(computeLateCharge(1000, "2026-10-01", "2026-10-06", grace)).toBeNull();
    expect(computeLateCharge(1000, "2026-10-01", "2026-10-07", grace)).toEqual({ days: 6, fee: 20, interest: 2, total: 22 });
  });

  it("sem regras configuradas (padrão) não cobra", () => {
    expect(computeLateCharge(1000, "2026-01-01", "2026-10-01", normalizeRules(undefined))).toBeNull();
  });

  it("só juros ou só multa", () => {
    expect(computeLateCharge(900, "2026-10-01", "2026-10-31", normalizeRules({ monthlyInterest: 3 }))).toEqual({ days: 30, fee: 0, interest: 27, total: 27 });
    expect(computeLateCharge(900, "2026-10-01", "2026-12-31", normalizeRules({ lateFee: 10 }))).toEqual({ days: 91, fee: 90, interest: 0, total: 90 });
  });

  it("saneia regras inválidas e datas fora do formato", () => {
    expect(normalizeRules({ lateFee: -5, monthlyInterest: 500, graceDays: 2.7 })).toEqual({ lateFee: 0, monthlyInterest: 100, graceDays: 2 });
    expect(computeLateCharge(1000, "01/10/2026", "2026-10-16", rules)).toBeNull();
    expect(computeLateCharge(0, "2026-10-01", "2026-10-16", rules)).toBeNull();
  });

  it("total da movimentação soma juros/multa", () => {
    expect(entryTotal({ value: 1000, lateCharge: { total: 25 } })).toBe(1025);
    expect(entryTotal({ value: 1000 })).toBe(1000);
  });
});
