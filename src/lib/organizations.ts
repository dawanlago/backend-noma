import mongoose, { type Types } from "mongoose";
import AppSettings from "../models/AppSettings";
import CustomField from "../models/CustomField";
import Funnel from "../models/Funnel";
import Label from "../models/Label";
import OptionItem from "../models/OptionItem";
import Organization, { type IOrganization } from "../models/Organization";
import User from "../models/User";
import { defaultAccess, type AccessLevels } from "./access";
import { effectivePermissions } from "./permissions";
import { OPTION_LISTS } from "./optionLists";
import { getSettings, seedFunnelAndMigrateLeads, seedOptionLists } from "./seedDefaults";
import { runWithOrg } from "./tenant";
import { MODULES } from "../types";

/** Migrações de dados antigos: só fazem sentido na primeira empresa; as novas já nascem "migradas". */
export const DATA_MIGRATIONS = [
  "modules-agenda-nps",
  "legacy-data-v1",
  "finance-cashbox-v1",
  "lead-stage-dates-v1",
  "lead-last-contact-v1",
  "org-stamp-v1",
  "org-indexes-v1",
  "org-users-v1",
  "contact-links-v1",
  "lead-created-by-v1",
  "product-costs-v1",
  "note-share-permission-v1",
];

/** Carimba com a empresa todo registro que ainda não tem uma (dados de antes da separação). */
async function stampOrg(orgId: Types.ObjectId) {
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    if (!model.schema.path("orgId")) continue;
    await model.collection.updateMany({ orgId: { $exists: false } }, { $set: { orgId } });
  }
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

/**
 * Primeira empresa: na primeira vez, é criada com o nome das configurações atuais
 * e recebe todos os dados que já existiam. À prova de dois servidores subindo juntos:
 * o índice único de `isPrimary` deixa só um criar.
 */
export async function ensurePrimaryOrganization(): Promise<IOrganization> {
  await Organization.init();
  const primary = await Organization.findOne({ isPrimary: true });
  if (primary) return primary;
  // Empresas criadas antes deste campo existir: a mais antiga vira a primeira.
  const earliest = await Organization.findOne().sort({ order: 1, createdAt: 1 });
  if (earliest) {
    await Organization.updateOne({ _id: earliest._id }, { $set: { isPrimary: true } }).catch((error) => {
      if (!isDuplicateKey(error)) throw error;
    });
    return (await Organization.findOne({ isPrimary: true }))!;
  }
  const settings = await AppSettings.collection.findOne({ key: "main" });
  let org: IOrganization | null = null;
  try {
    org = await Organization.findOneAndUpdate(
      { isPrimary: true },
      {
        $setOnInsert: {
          name: (settings?.companyName as string) || "Noma Produtora",
          logo: (settings?.brand as { logo?: string } | undefined)?.logo || "",
          order: 0,
          isActive: true,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    // Outro servidor criou no mesmo instante.
    if (!isDuplicateKey(error)) throw error;
    org = await Organization.findOne({ isPrimary: true });
  }
  // Carimbar é idempotente (só mexe no que ainda não tem empresa).
  await stampOrg(org!._id);
  console.log(`Empresa principal: ${org!.name}`);
  return org!;
}

/**
 * Conserto da primeira publicação: dois servidores subindo juntos podiam criar uma segunda
 * "primeira empresa" vazia, com o mesmo nome. Ela é desativada (não apagada) se não tiver nada.
 */
export async function deactivateEmptyDuplicates(primary: IOrganization) {
  const candidates = await Organization.find({
    _id: { $ne: primary._id },
    name: primary.name,
    isActive: true,
    createdAt: { $lte: new Date(primary.createdAt.getTime() + 10 * 60_000) },
  });
  const db = mongoose.connection.db!;
  for (const org of candidates) {
    const used = await Promise.all(
      ["leads", "contacts", "companies", "financeentries", "tooldocuments", "forms", "tasks", "notes"].map((name) => db.collection(name).countDocuments({ orgId: org._id }, { limit: 1 })),
    );
    const members = await User.countDocuments({ "memberships.orgId": org._id });
    if (used.some(Boolean) || members) continue;
    await Organization.updateOne({ _id: org._id }, { $set: { isActive: false, name: `${org.name} (duplicada)` } });
    console.log(`Empresa duplicada e vazia desativada: ${org._id}`);
  }
}

async function once(key: string, action: () => Promise<void>) {
  const settings = await getSettings();
  if (settings.migrations.includes(key)) return;
  await action();
  await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
}

/** Ajustes únicos da separação por empresa. Roda dentro da primeira empresa. */
export async function migrateToOrganizations(primary: IOrganization) {
  // Registros criados por migrações antigas nesta mesma inicialização.
  await once("org-stamp-v1", () => stampOrg(primary._id));
  // Índices únicos passaram a ser por empresa: remove os antigos (globais).
  await once("org-indexes-v1", async () => {
    for (const model of [AppSettings, CustomField, OptionItem, Label]) await model.syncIndexes();
  });
  // Usuários de antes: entram na primeira empresa com o mesmo acesso que tinham; admins viram administradores gerais.
  await once("org-users-v1", async () => {
    const users = await User.find({ "memberships.0": { $exists: false } });
    for (const user of users) {
      const allowed = effectivePermissions(user);
      const access = Object.fromEntries(
        MODULES.map((key) => [key, user.role === "admin" ? "all" : allowed.includes(key) ? "own" : "none"]),
      ) as AccessLevels;
      // Só quem ainda não tem vínculo (outro servidor pode ter migrado no mesmo instante).
      await User.updateOne(
        { _id: user._id, "memberships.0": { $exists: false } },
        { $set: { memberships: [{ orgId: primary._id, role: user.role, access }], ...(user.role === "admin" ? { isSuperAdmin: true } : {}) } },
      );
    }
  });
}

const CONFIG_FIELDS = "-_id -orgId -createdAt -updatedAt -__v";

/** Copia funis, listas de opções, campos personalizados e etiquetas de uma empresa para a atual. */
async function copyConfigFrom(sourceId: Types.ObjectId) {
  const source = await runWithOrg(sourceId, async () => ({
    funnels: await Funnel.find().select(CONFIG_FIELDS).lean(),
    fields: await CustomField.find().select("-orgId -createdAt -updatedAt -__v").lean(),
    options: await OptionItem.find().select(CONFIG_FIELDS).lean(),
    labels: await Label.find().select(CONFIG_FIELDS).lean(),
  }));
  if (source.funnels.length) await Funnel.insertMany(source.funnels);
  if (source.labels.length) await Label.insertMany(source.labels);
  // Opções de campo ficam na lista "field:<id do campo>": o id muda na cópia.
  const fieldIds = new Map<string, string>();
  // Campo de um funil só: aponta para o funil de mesmo nome na cópia.
  const sourceFunnels = await runWithOrg(sourceId, () => Funnel.find().select("name").lean());
  const copiedFunnels = await Funnel.find().select("name").lean();
  const funnelOf = (id: unknown) => {
    const name = sourceFunnels.find((funnel) => String(funnel._id) === String(id))?.name;
    return copiedFunnels.find((funnel) => funnel.name === name)?._id;
  };
  for (const { _id, ...field } of source.fields) {
    const created = await CustomField.create({ ...field, funnelId: field.funnelId ? funnelOf(field.funnelId) : undefined });
    fieldIds.set(String(_id), String(created._id));
  }
  const options = source.options
    .map((item) => {
      if (!item.list.startsWith("field:")) return item;
      const mapped = fieldIds.get(item.list.slice(6));
      return mapped ? { ...item, list: `field:${mapped}` } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (options.length) await OptionItem.insertMany(options);
}

/**
 * Cria uma empresa nova, já com configurações, listas de opções e um funil.
 * Com `copyFrom`, copia a configuração (funis, opções, campos, etiquetas) de outra empresa.
 */
export async function createOrganization(input: { name: string; logo?: string; color?: string; copyFrom?: Types.ObjectId | null }) {
  const last = await Organization.findOne().sort({ order: -1 }).select("order").lean();
  const org = await Organization.create({ name: input.name, logo: input.logo || "", color: input.color || "", order: (last?.order ?? -1) + 1 });
  await runWithOrg(org._id, async () => {
    await AppSettings.create({
      key: "main",
      companyName: org.name,
      migrations: DATA_MIGRATIONS,
      seededLists: input.copyFrom ? OPTION_LISTS : [],
      ...(org.logo ? { brand: { logo: org.logo } } : {}),
    });
    if (input.copyFrom) await copyConfigFrom(input.copyFrom);
    await seedOptionLists();
    await seedFunnelAndMigrateLeads();
  });
  return org;
}

/** Acesso de administrador (tudo liberado) — usado ao criar o vínculo de quem cria a empresa. */
export function adminMembership(orgId: Types.ObjectId) {
  return { orgId, role: "admin" as const, access: defaultAccess("admin") };
}
