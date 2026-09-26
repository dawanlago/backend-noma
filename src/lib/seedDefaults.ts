import AppSettings from "../models/AppSettings";
import Funnel from "../models/Funnel";
import Lead from "../models/Lead";
import OptionItem from "../models/OptionItem";
import User from "../models/User";
import { LEGACY_LEAD_STAGES } from "../types";
import { defaultItems, OPTION_LISTS } from "./optionLists";
import { legacyLeadPatch } from "./leadMigration";

export async function getSettings() {
  return AppSettings.findOneAndUpdate({ key: "main" }, { $setOnInsert: { key: "main" } }, { returnDocument: "after", upsert: true });
}

/** Cria as listas de opções que ainda não foram semeadas (o que o usuário apagou não volta). */
export async function seedOptionLists() {
  const settings = await getSettings();
  const pending = OPTION_LISTS.filter((list) => !settings.seededLists.includes(list));
  if (!pending.length) return;
  for (const list of pending) {
    await Promise.all(
      defaultItems(list).map((item) =>
        OptionItem.updateOne({ list, value: item.value }, { $setOnInsert: item }, { upsert: true }),
      ),
    );
  }
  await AppSettings.updateOne({ key: "main" }, { $addToSet: { seededLists: { $each: pending } } });
}

/** Garante um funil padrão com as etapas do antigo CRM e migra os leads antigos para ele. */
export async function seedFunnelAndMigrateLeads() {
  let funnel = await Funnel.findOne().sort({ order: 1, createdAt: 1 });
  if (!funnel) {
    funnel = await Funnel.create({
      name: "Funil comercial",
      order: 0,
      stages: [
        ...LEGACY_LEAD_STAGES.map((stage) => ({
          name: stage.name,
          key: stage.key,
          kind: stage.key === "won" ? "won" : "open",
        })),
        { name: "Perdido", key: "lost", kind: "lost" },
      ],
    });
  }

  const legacy = await Lead.collection.find({ funnelId: { $exists: false } }).toArray();
  if (!legacy.length) return;
  const stages = funnel.stages.map((stage) => ({ _id: stage._id, key: stage.key, kind: stage.kind }));
  await Lead.collection.bulkWrite(
    legacy.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: legacyLeadPatch(doc, funnel!._id, stages) },
      },
    })),
  );
}

/**
 * Áreas novas (Agenda e NPS): quem já tinha a lista de acessos salva ganha a área
 * equivalente uma única vez; depois disso o admin decide.
 */
export async function migrateNewModules() {
  const key = "modules-agenda-nps";
  const settings = await getSettings();
  if (settings.migrations.includes(key)) return;
  await User.updateMany({ permissions: "atividades" }, { $addToSet: { permissions: "agenda" } });
  await User.updateMany({ permissions: "crm" }, { $addToSet: { permissions: "nps" } });
  await User.updateMany({}, { $pull: { permissions: "biblioteca" } });
  await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
}
