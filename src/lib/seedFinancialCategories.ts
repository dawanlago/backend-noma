import FinancialCategory from "../models/FinancialCategory";

export async function seedFinancialCategories() {
  const existing = await FinancialCategory.countDocuments();
  if (existing > 0) return;

  await FinancialCategory.insertMany([
    { name: "Operacional", percentage: 30, order: 1, isActive: true },
    { name: "Imposto", percentage: 6, order: 2, isActive: true },
    { name: "Lucro", percentage: 64, order: 3, isActive: true },
  ]);

  console.log("Default financial categories created.");
}
