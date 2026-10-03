import AppSettings from "../models/AppSettings";
import Note from "../models/Note";
import { getSettings } from "./seedDefaults";
import { orgFilter } from "./tenant";

/**
 * Compartilhamentos de antes da permissão eram só leitura: ganham `permission: "view"`.
 * Roda dentro de cada empresa que já existia (as novas nascem com a chave marcada).
 */
export async function migrateNoteShares() {
  const key = "note-share-permission-v1";
  const settings = await getSettings();
  if (settings.migrations.includes(key)) return;
  // Direto na coleção (sem os hooks do plugin): o filtro da empresa vai à mão.
  await Note.collection.updateMany(
    { "shares.0": { $exists: true }, ...orgFilter() },
    [
      {
        $set: {
          shares: {
            $map: {
              input: "$shares",
              as: "share",
              in: { userId: "$$share.userId", permission: { $ifNull: ["$$share.permission", "view"] } },
            },
          },
        },
      },
    ],
  );
  await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
}
