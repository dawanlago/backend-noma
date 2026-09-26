import { connectToDatabase } from "../config/db";
import Company from "../models/Company";
import { seedAdminUser } from "./seedAdmin";
import {
  migrateFinanceCashbox,
  migrateLeadLastContact,
  migrateLeadStageDates,
  migrateLegacyData,
  migrateNewModules,
  seedFunnelAndMigrateLeads,
  seedOptionLists,
} from "./seedDefaults";

let started: Promise<void> | null = null;

export function bootstrapApp() {
  if (!started) {
    started = (async () => {
      await connectToDatabase();
      await seedAdminUser();
      await seedOptionLists();
      await migrateLegacyData();
      await seedFunnelAndMigrateLeads();
      await migrateNewModules();
      await migrateFinanceCashbox().catch((error) => console.error("[migracao:finance-cashbox-v1]", error));
      await migrateLeadStageDates().catch((error) => console.error("[migracao:lead-stage-dates-v1]", error));
      await migrateLeadLastContact().catch((error) => console.error("[migracao:lead-last-contact-v1]", error));
      // Remove o índice único antigo de CNPJ: agora ele é opcional.
      await Company.syncIndexes();
    })().catch((error) => {
      started = null;
      throw error;
    });
  }

  return started;
}
