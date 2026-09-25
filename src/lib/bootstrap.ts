import { connectToDatabase } from "../config/db";
import Company from "../models/Company";
import { seedAdminUser } from "./seedAdmin";
import { seedFunnelAndMigrateLeads, seedOptionLists } from "./seedDefaults";
import { seedLibrary } from "./seedLibrary";

let started: Promise<void> | null = null;

export function bootstrapApp() {
  if (!started) {
    started = (async () => {
      await connectToDatabase();
      await seedAdminUser();
      await seedLibrary();
      await seedOptionLists();
      await seedFunnelAndMigrateLeads();
      // Remove o índice único antigo de CNPJ: agora ele é opcional.
      await Company.syncIndexes();
    })().catch((error) => {
      started = null;
      throw error;
    });
  }

  return started;
}
