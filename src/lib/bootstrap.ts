import { connectToDatabase } from "../config/db";
import { seedAdminUser } from "./seedAdmin";
import { seedDefaultFunnel } from "./seedDefaultFunnel";
import { seedFinancialCategories } from "./seedFinancialCategories";

let started: Promise<void> | null = null;

export function bootstrapApp() {
  if (!started) {
    started = (async () => {
      await connectToDatabase();
      await seedAdminUser();
      await seedDefaultFunnel();
      await seedFinancialCategories();
    })();
  }

  return started;
}
