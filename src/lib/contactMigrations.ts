import AppSettings from "../models/AppSettings";
import Contact from "../models/Contact";
import { phoneKey } from "./phone";
import { getSettings } from "./seedDefaults";
import { orgFilter } from "./tenant";

/**
 * Contatos de antes: grava o telefone normalizado (`phoneKey`, usado para achar duplicados)
 * e passa a empresa única (`companyId`) para a lista `companyIds`.
 * Roda dentro de cada empresa que já existia (as novas nascem com a chave marcada).
 */
export async function migrateContacts() {
  const key = "contact-links-v1";
  const settings = await getSettings();
  if (settings.migrations.includes(key)) return;
  // Direto na coleção (sem os hooks do plugin): o filtro da empresa vai à mão.
  const contacts = await Contact.collection
    .find({ $or: [{ phoneKey: { $exists: false } }, { companyIds: { $exists: false } }], ...orgFilter() })
    .project({ phone: 1, companyId: 1, companyIds: 1 })
    .toArray();
  if (contacts.length) {
    await Contact.collection.bulkWrite(
      contacts.map((contact) => ({
        updateOne: {
          filter: { _id: contact._id, ...orgFilter() },
          update: {
            $set: {
              phoneKey: phoneKey(contact.phone),
              companyIds: Array.isArray(contact.companyIds) ? contact.companyIds : contact.companyId ? [contact.companyId] : [],
            },
          },
        },
      })),
    );
  }
  await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
}
