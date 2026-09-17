import { describe, expect, it } from "vitest";
import {
  assertCategoriesReadyForDistribution,
  assertCategoriesWithinLimit,
  buildDistribution,
  sumPercentages,
} from "./financialDistribution";

describe("financial distribution", () => {
  it("sums percentages", () => {
    expect(
      sumPercentages([
        { percentage: 30 },
        { percentage: 6 },
        { percentage: 64 },
      ]),
    ).toBe(100);
  });

  it("rejects sums above 100", () => {
    expect(() =>
      assertCategoriesWithinLimit([
        { percentage: 80 },
        { percentage: 30 },
      ]),
    ).toThrow(/não pode ultrapassar 100%/);
  });

  it("requires exactly 100 for distribution", () => {
    expect(() =>
      assertCategoriesReadyForDistribution([
        { percentage: 30 },
        { percentage: 6 },
      ]),
    ).toThrow(/exatamente 100%/);
  });

  it("splits 10000 into 3000 / 600 / 6400", () => {
    const result = buildDistribution(10000, [
      { _id: "a", name: "Operacional", percentage: 30 },
      { _id: "b", name: "Imposto", percentage: 6 },
      { _id: "c", name: "Lucro", percentage: 64 },
    ]);

    expect(result.map((item) => item.value)).toEqual([3000, 600, 6400]);
    expect(result.reduce((sum, item) => sum + item.value, 0)).toBe(10000);
  });
});
