import type { Request, Response, NextFunction } from "express";
import Company from "../models/Company";
import Deal from "../models/Deal";
import NPSRating from "../models/NPSRating";
import Transaction from "../models/Transaction";
import Funnel from "../models/Funnel";

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const isAdmin = req.user?.role === "admin";

    const [deals, activeCompanies, transactions, ratings, funnels] = await Promise.all([
      Deal.find().sort({ createdAt: -1 }),
      Company.countDocuments({ isActive: true }),
      isAdmin ? Transaction.find({ date: { $gte: monthStart } }) : Promise.resolve([] as Awaited<ReturnType<typeof Transaction.find>>),
      NPSRating.find({ date: { $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } }),
      Funnel.find(),
    ]);

    const openDeals = deals.filter((deal) => deal.value >= 0);
    const pipelineValue = openDeals.reduce((sum, deal) => sum + deal.value, 0);

    const income = transactions
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + item.value, 0);
    const expense = transactions
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + item.value, 0);

    const averageNps =
      ratings.length > 0
        ? ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length
        : null;

    res.json({
      data: {
        openDeals: openDeals.length,
        pipelineValue,
        activeCompanies,
        averageNps,
        monthlyIncome: isAdmin ? income : null,
        monthlyExpense: isAdmin ? expense : null,
        monthlyBalance: isAdmin ? income - expense : null,
        funnelsCount: funnels.length,
        recentDeals: deals.slice(0, 5),
        canViewFinance: isAdmin,
      },
    });
  } catch (error) {
    next(error);
  }
}
