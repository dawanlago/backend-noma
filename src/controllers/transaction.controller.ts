import type { Request, Response, NextFunction } from "express";
import FinancialCategory from "../models/FinancialCategory";
import Transaction from "../models/Transaction";
import {
  assertCategoriesWithinLimit,
  sumPercentages,
} from "../lib/financialDistribution";

function serializeTransaction(transaction: InstanceType<typeof Transaction>) {
  const json = transaction.toJSON() as unknown as Record<string, unknown>;
  const deal = json.dealId as { _id?: unknown; title?: string; funnelId?: unknown } | string | undefined;

  return {
    ...json,
    dealId: typeof deal === "object" && deal?._id ? String(deal._id) : deal,
    deal:
      typeof deal === "object"
        ? { title: deal.title || "Negociação", funnelId: deal.funnelId ? String(deal.funnelId) : "" }
        : undefined,
  };
}

export async function createTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }

    const transaction = await Transaction.create({
      ...req.body,
      userId: req.user._id,
    });

    res.status(201).json({ data: transaction });
  } catch (error) {
    next(error);
  }
}

export async function listTransactions(_req: Request, res: Response, next: NextFunction) {
  try {
    const transactions = await Transaction.find()
      .sort({ date: -1 })
      .populate("dealId", "title funnelId");

    res.json({ data: transactions.map(serializeTransaction) });
  } catch (error) {
    next(error);
  }
}

export async function listFinancialCategories(_req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await FinancialCategory.find().sort({ order: 1, name: 1 });
    res.json({
      data: categories,
      meta: {
        activeSum: sumPercentages(categories.filter((category) => category.isActive)),
        readyForDistribution: sumPercentages(categories.filter((category) => category.isActive)) === 100,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function nextCategorySum(params: {
  percentage: number;
  excludeId?: string;
  isActive?: boolean;
}) {
  const categories = await FinancialCategory.find({ isActive: true });
  const others = categories.filter((category) => category._id.toString() !== params.excludeId);
  const active = params.isActive === false ? others : [...others, { percentage: params.percentage }];
  return assertCategoriesWithinLimit(active);
}

export async function createFinancialCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const percentage = Number(req.body.percentage);
    if (!req.body.name || Number.isNaN(percentage) || percentage < 0) {
      res.status(400).json({ error: "Informe nome e percentual válidos." });
      return;
    }

    await nextCategorySum({ percentage, isActive: req.body.isActive !== false });

    const count = await FinancialCategory.countDocuments();
    const category = await FinancialCategory.create({
      name: req.body.name,
      percentage,
      order: Number(req.body.order ?? count + 1),
      isActive: req.body.isActive !== false,
    });

    res.status(201).json({ data: category });
  } catch (error) {
    next(error);
  }
}

export async function updateFinancialCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await FinancialCategory.findById(req.params.id);
    if (!category) {
      res.status(404).json({ error: "Categoria não encontrada." });
      return;
    }

    const percentage = req.body.percentage === undefined ? category.percentage : Number(req.body.percentage);
    const isActive = req.body.isActive === undefined ? category.isActive : Boolean(req.body.isActive);

    await nextCategorySum({
      percentage,
      excludeId: category._id.toString(),
      isActive,
    });

    category.name = req.body.name ?? category.name;
    category.percentage = percentage;
    category.isActive = isActive;
    if (req.body.order !== undefined) category.order = Number(req.body.order);
    await category.save();

    res.json({ data: category });
  } catch (error) {
    next(error);
  }
}

export async function deleteFinancialCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await FinancialCategory.findByIdAndDelete(req.params.id);
    if (!category) {
      res.status(404).json({ error: "Categoria não encontrada." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

function inRange(date: Date, from?: Date, to?: Date) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export async function getFinanceDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const categoryId = req.query.categoryId ? String(req.query.categoryId) : "";

    const transactions = await Transaction.find().sort({ date: 1 }).populate("dealId", "title funnelId");
    const filtered = transactions.filter((item) => {
      if (!inRange(item.date, from, Number.isNaN(to?.getTime()) ? undefined : to)) return false;
      if (categoryId) {
        const matchesDistribution = (item.distribution || []).some(
          (entry) => entry.categoryId?.toString() === categoryId,
        );
        const matchesLegacy = item.category === categoryId;
        if (!matchesDistribution && !matchesLegacy) return false;
      }
      return true;
    });

    const sales = filtered.filter((item) => item.type === "income" && item.category === "sale");
    const income = filtered.filter((item) => item.type === "income").reduce((sum, item) => sum + item.value, 0);
    const expense = filtered.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.value, 0);

    const byCategory = new Map<string, number>();
    for (const item of sales) {
      if (item.distribution?.length) {
        for (const entry of item.distribution) {
          byCategory.set(entry.categoryName, (byCategory.get(entry.categoryName) || 0) + entry.value);
        }
      } else if (item.productCalculation) {
        const legacy = [
          ["Operacional", item.productCalculation.operational],
          ["Marketing", item.productCalculation.marketing10],
          ["Imposto", item.productCalculation.tax8],
          ["Equipamento", item.productCalculation.equipment7],
          ["Caixa", item.productCalculation.cash5],
          ["Lucro", item.productCalculation.profit25],
        ] as const;
        for (const [name, value] of legacy) {
          byCategory.set(name, (byCategory.get(name) || 0) + value);
        }
      }
    }

    const evolutionMap = new Map<string, { sold: number; moved: number; sales: number }>();
    for (const item of filtered) {
      const key = item.date.toISOString().slice(0, 7);
      const current = evolutionMap.get(key) || { sold: 0, moved: 0, sales: 0 };
      current.moved += item.type === "income" ? item.value : 0;
      if (item.type === "income" && item.category === "sale") {
        current.sold += item.value;
        current.sales += 1;
      }
      evolutionMap.set(key, current);
    }

    res.json({
      data: {
        totalSold: sales.reduce((sum, item) => sum + item.value, 0),
        totalMoved: income,
        totalExpense: expense,
        balance: income - expense,
        salesCount: sales.length,
        byCategory: [...byCategory.entries()].map(([name, value]) => ({ name, value })),
        evolution: [...evolutionMap.entries()].map(([period, values]) => ({ period, ...values })),
        transactions: filtered.reverse().map(serializeTransaction),
      },
    });
  } catch (error) {
    next(error);
  }
}
