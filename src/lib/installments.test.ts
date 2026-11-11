import { describe, expect, it } from "vitest";
import { addMonths, priceInterest, splitInstallments } from "./installments";

describe("financeiro: parcelamento", () => {
  it("gera uma parcela por mês, mantendo o dia ou usando o último dia do mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-10", 2)).toBe("2027-01-10");
  });

  it("divide principal e juros; os centavos que sobram vão na primeira parcela", () => {
    const parts = splitInstallments(1000, 100, 3, "2026-11-10");
    expect(parts.map((part) => part.date)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
    expect(parts.map((part) => part.value)).toEqual([333.34, 333.33, 333.33]);
    expect(parts.map((part) => part.interest)).toEqual([33.34, 33.33, 33.33]);
    const total = parts.reduce((sum, part) => sum + part.value + part.interest, 0);
    expect(Math.round(total * 100) / 100).toBe(1100);
  });

  it("calcula os juros pela taxa mensal (tabela Price)", () => {
    // R$ 1.000 em 12x a 2% a.m.: parcela de 94,56 → juros de ~134,72.
    expect(priceInterest(1000, 2, 12)).toBeCloseTo(134.72, 1);
    expect(priceInterest(1000, 0, 12)).toBe(0);
  });
});
