import AppSettings from "../models/AppSettings";
import Funnel from "../models/Funnel";
import Lead from "../models/Lead";
import OptionItem from "../models/OptionItem";
import User from "../models/User";
import Task from "../models/Task";
import Note from "../models/Note";
import NoteGroup from "../models/NoteGroup";
import Form from "../models/Form";
import FormResponse from "../models/FormResponse";
import FormInvite from "../models/FormInvite";
import NPSInvite from "../models/NPSInvite";
import MonthlyGoal from "../models/MonthlyGoal";
import { newPublicId } from "./forms";
import {
  legacyAnswers,
  legacyDealToLead,
  legacyFormFields,
  legacyTaskPatch,
  normalizeLegacyStages,
  type LegacyStage,
} from "./legacyMigration";
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

/**
 * Dados da primeira versão do sistema (negociações "deals", tarefas, anotações,
 * formulários e convites) no formato atual. Roda uma vez; cada passo também só
 * mexe no que ainda está no formato antigo.
 */
export async function migrateLegacyData() {
  try {
    await runLegacyMigration();
  } catch (error) {
    // Nunca derruba a API: registra e tenta de novo na próxima inicialização.
    console.error("[migracao:legacy-data-v1]", error instanceof Error ? error.message : error);
  }
}

async function runLegacyMigration() {
  const key = "legacy-data-v1";
  const settings = await getSettings();
  if (!settings.migrations.includes(key)) {
    const nativeDb = Funnel.db.db!;
    const db = (name: string) => nativeDb.collection(name);

    // Índices únicos da versão antiga (ex.: dealId+formId) travariam a conversão: saem antes.
    const legacyIndexes: Record<string, string[]> = {
      formresponses: ["dealId_1_formId_1", "dealId_1_submittedAt_-1", "formId_1_contactId_1"],
      forminvites: ["dealId_1_formId_1", "dealId_1_createdAt_-1"],
      tasks: ["dealId_1_isCompleted_1", "userId_1_dueDate_1", "contactId_1_dueDate_1", "funnelId_1_dueDate_1", "dealId_1_status_1", "dueDate_-1"],
      notes: ["userId_1_groupId_1_updatedAt_-1"],
      notegroups: ["userId_1_order_1"],
    };
    for (const [collection, names] of Object.entries(legacyIndexes)) {
      const existing = new Set((await db(collection).indexes().catch(() => [])).map((index) => index.name));
      for (const name of names) if (existing.has(name)) await db(collection).dropIndex(name);
    }
    const admin = await User.findOne({ role: "admin" }).sort({ createdAt: 1 }).select("_id").lean();

    // Funis: etapas antigas usavam `type` (general/agenda/closure).
    const funnels = await db("funnels").find().toArray();
    for (const funnel of funnels) {
      const stages = (funnel.stages || []) as LegacyStage[];
      if (stages.some((stage) => !stage.kind)) {
        await db("funnels").updateOne({ _id: funnel._id }, { $set: { stages: normalizeLegacyStages(stages) } });
      }
    }

    // Negociações antigas viram leads com o mesmo _id (tarefas e respostas continuam ligadas).
    const deals = await db("deals").find().toArray();
    if (deals.length) {
      const existing = new Set((await db("leads").find({ _id: { $in: deals.map((deal) => deal._id) } }).project({ _id: 1 }).toArray()).map((lead) => String(lead._id)));
      const [freshFunnels, products, users, contacts, companies] = await Promise.all([
        db("funnels").find().sort({ order: 1, createdAt: 1 }).toArray(),
        db("products").find().toArray(),
        db("users").find().project({ name: 1 }).toArray(),
        db("contacts").find().project({ name: 1 }).toArray(),
        db("companies").find().project({ name: 1 }).toArray(),
      ]);
      const ctx = {
        funnels: freshFunnels.map((funnel) => ({ _id: funnel._id, stages: funnel.stages as LegacyStage[] })),
        products: new Map(products.map((item) => [String(item._id), { name: item.name, price: (Number(item.operationalCost) || 0) + (Number(item.profit) || 0) }])),
        userNames: new Map(users.map((item) => [String(item._id), item.name])),
        contactNames: new Map(contacts.map((item) => [String(item._id), item.name])),
        companyNames: new Map(companies.map((item) => [String(item._id), item.name])),
      };
      const fresh = deals.filter((deal) => !existing.has(String(deal._id))).map((deal) => legacyDealToLead(deal, ctx)).filter((lead) => lead.funnelId && lead.stageId && lead.ownerId);
      if (fresh.length) await db("leads").insertMany(fresh as never[]);
    }

    // Tarefas: userId/Date/isCompleted → ownerId/"YYYY-MM-DD"+horário/status.
    const leadIds = new Set((await db("leads").find().project({ _id: 1 }).toArray()).map((lead) => String(lead._id)));
    const tasks = await db("tasks").find({ $or: [{ ownerId: { $exists: false } }, { dueDate: { $type: "date" } }] }).toArray();
    for (const task of tasks) await db("tasks").updateOne({ _id: task._id }, legacyTaskPatch(task, leadIds));

    // Anotações e grupos: userId → ownerId.
    for (const name of ["notes", "notegroups"]) {
      await db(name).updateMany({ ownerId: { $exists: false }, userId: { $exists: true } }, [
        { $set: { ownerId: "$userId", order: { $ifNull: ["$order", 0] } } },
        { $unset: "userId" },
      ]);
    }

    // Formulários sem dono/link público; respostas e convites ligados a "deals".
    const forms = await db("forms").find({ $or: [{ ownerId: { $exists: false } }, { publicId: { $exists: false } }] }).toArray();
    for (const form of forms) {
      await db("forms").updateOne(
        { _id: form._id },
        {
          $set: {
            ownerId: form.ownerId || admin?._id,
            publicId: form.publicId || newPublicId(),
            fields: legacyFormFields(form.fields || []),
            description: form.description || "",
            successMessage: form.successMessage || "Recebemos suas respostas. Obrigado!",
            createLead: form.createLead ?? true,
          },
        },
      );
    }
    const formOwners = new Map((await db("forms").find().project({ ownerId: 1 }).toArray()).map((form) => [String(form._id), form.ownerId]));
    const responses = await db("formresponses").find({ $or: [{ dealId: { $exists: true } }, { ownerId: { $exists: false } }] }).toArray();
    for (const response of responses) {
      await db("formresponses").updateOne(
        { _id: response._id },
        {
          $set: {
            answers: legacyAnswers(response.answers),
            ownerId: response.ownerId || formOwners.get(String(response.formId)) || admin?._id,
            ...(response.dealId ? { leadId: response.dealId } : {}),
          },
          $unset: { dealId: "", submittedAt: "" },
        },
      );
    }
    await db("forminvites").updateMany({ dealId: { $exists: true } }, [
      { $set: { leadId: "$dealId", ownerId: { $ifNull: ["$ownerId", admin?._id] } } },
      { $unset: "dealId" },
    ]);
    await db("npsinvites").updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: admin?._id } });

    await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
  }

  // Índices únicos antigos (ex.: dealId+formId) bloqueariam respostas novas; alinha com os schemas atuais.
  await Promise.all([Task, Note, NoteGroup, Form, FormResponse, FormInvite, NPSInvite].map((model) => model.syncIndexes()));
}

/**
 * Caixas do financeiro: o que já existia era todo da Noma. Entradas, despesas
 * recorrentes e metas sem caixa passam para o primeiro caixa cadastrado.
 */
export async function migrateFinanceCashbox() {
  const key = "finance-cashbox-v1";
  const settings = await getSettings();
  if (!settings.migrations.includes(key)) {
    const first = await OptionItem.findOne({ list: "financeCashbox" }).sort({ order: 1 }).lean();
    const cashbox = first?.value || "Noma";
    const nativeDb = Funnel.db.db!;
    for (const name of ["financeentries", "recurringexpenses"]) {
      await nativeDb.collection(name).updateMany({ $or: [{ cashbox: { $exists: false } }, { cashbox: "" }] }, { $set: { cashbox } });
    }
    // As metas antigas valiam para tudo: ficam como meta de "Todos os caixas".
    await nativeDb.collection("monthlygoals").updateMany({ cashbox: { $exists: false } }, { $set: { cashbox: "" } });
    await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
  }
  // A meta passou a ser por caixa: troca o índice único (dono+mês) por (dono+mês+caixa).
  const legacyIndex = "ownerId_1_month_1";
  const indexes = await MonthlyGoal.collection.indexes().catch(() => []);
  if (indexes.some((index) => index.name === legacyIndex)) {
    await MonthlyGoal.collection.dropIndex(legacyIndex).catch(() => undefined);
  }
  await MonthlyGoal.createIndexes();
}
