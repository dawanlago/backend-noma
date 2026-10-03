import { connectToDatabase } from "../config/db";
import Company from "../models/Company";
import Organization from "../models/Organization";
import { ensurePrimaryOrganization, migrateToOrganizations } from "./organizations";
import { migrateDealsAndProducts } from "./dealMigrations";
import { migrateContacts } from "./contactMigrations";
import { migrateNoteShares } from "./noteMigrations";
import { seedAdminUser } from "./seedAdmin";
import { runWithOrg } from "./tenant";
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
      // Separação por empresa: os dados de antes ficam na primeira empresa.
      const primary = await ensurePrimaryOrganization();
      await seedAdminUser();
      // As migrações de dados antigos só valem para a primeira empresa.
      await runWithOrg(primary._id, async () => {
        await seedOptionLists();
        await migrateLegacyData();
        await seedFunnelAndMigrateLeads();
        await migrateNewModules();
        await migrateFinanceCashbox().catch((error) => console.error("[migracao:finance-cashbox-v1]", error));
        await migrateLeadStageDates().catch((error) => console.error("[migracao:lead-stage-dates-v1]", error));
        await migrateLeadLastContact().catch((error) => console.error("[migracao:lead-last-contact-v1]", error));
        await migrateToOrganizations(primary).catch((error) => console.error("[migracao:empresas]", error));
      });
      // Listas de opções novas chegam a todas as empresas.
      const others = await Organization.find({ _id: { $ne: primary._id } }).select("_id").lean();
      for (const org of others) await runWithOrg(org._id, seedOptionLists);
      // Quem criou a negociação e linhas de custo dos produtos: vale para todas as empresas que já existiam.
      for (const org of [primary, ...others]) {
        await runWithOrg(org._id, migrateDealsAndProducts).catch((error) => console.error("[migracao:negociacoes-produtos]", error));
      }
      // Contatos de antes: telefone normalizado (duplicados) e lista de empresas vinculadas.
      for (const org of [primary, ...others]) {
        await runWithOrg(org._id, migrateContacts).catch((error) => console.error("[migracao:contact-links-v1]", error));
      }
      // Anotações compartilhadas de antes: viram "só visualizar".
      for (const org of [primary, ...others]) {
        await runWithOrg(org._id, migrateNoteShares).catch((error) => console.error("[migracao:note-share-permission-v1]", error));
      }
      // Remove o índice único antigo de CNPJ: agora ele é opcional.
      await Company.syncIndexes();
    })().catch((error) => {
      started = null;
      throw error;
    });
  }

  return started;
}
