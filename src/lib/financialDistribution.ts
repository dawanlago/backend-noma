import type { IProduct } from "../models/Product";
import { FINANCIAL_DISTRIBUTION } from "./constants";

export interface DistributionCategoryInput {
  _id?: { toString(): string } | string;
  name: string;
  percentage: number;
}

export interface DistributionItem {
  categoryId?: string;
  categoryName: string;
  percentage: number;
  value: number;
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sumPercentages(categories: Array<{ percentage: number }>) {
  return roundMoney(categories.reduce((sum, category) => sum + Number(category.percentage || 0), 0));
}

export function assertCategoriesWithinLimit(categories: Array<{ percentage: number }>) {
  const total = sumPercentages(categories);
  if (total > 100) {
    throw new Error(`A soma dos percentuais não pode ultrapassar 100%. Soma atual: ${total}%.`);
  }
  return total;
}

export function assertCategoriesReadyForDistribution(categories: Array<{ percentage: number }>) {
  if (!categories.length) {
    throw new Error("Cadastre categorias financeiras antes de distribuir uma venda.");
  }

  const total = sumPercentages(categories);
  if (total !== 100) {
    throw new Error(`A soma dos percentuais deve ser exatamente 100% para distribuir a venda. Soma atual: ${total}%.`);
  }
  return total;
}

export function buildDistribution(
  dealValue: number,
  categories: DistributionCategoryInput[],
): DistributionItem[] {
  assertCategoriesReadyForDistribution(categories);

  const items: DistributionItem[] = [];
  let allocated = 0;

  categories.forEach((category, index) => {
    const isLast = index === categories.length - 1;
    const value = isLast
      ? roundMoney(dealValue - allocated)
      : roundMoney(dealValue * (Number(category.percentage) / 100));

    if (!isLast) allocated = roundMoney(allocated + value);

    items.push({
      categoryId: category._id ? String(category._id) : undefined,
      categoryName: category.name,
      percentage: Number(category.percentage),
      value,
    });
  });

  return items;
}

export function buildProductCalculation(dealValue: number, products: IProduct[]) {
  const operational = products.reduce((sum, product) => sum + product.operationalCost, 0);
  const base = dealValue > 0 ? dealValue : operational;

  return {
    operational,
    marketing10: base * FINANCIAL_DISTRIBUTION.marketing,
    tax8: base * FINANCIAL_DISTRIBUTION.tax,
    equipment7: base * FINANCIAL_DISTRIBUTION.equipment,
    cash5: base * FINANCIAL_DISTRIBUTION.cash,
    profit25: base * FINANCIAL_DISTRIBUTION.profit,
  };
}
