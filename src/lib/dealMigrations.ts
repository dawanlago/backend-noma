import AppSettings from "../models/AppSettings";
import Lead from "../models/Lead";
import Product from "../models/Product";
import { getSettings } from "./seedDefaults";
import { orgFilter } from "./tenant";

async function once(key: string, action: () => Promise<void>) {
  const settings = await getSettings();
  if (settings.migrations.includes(key)) return;
  await action();
  await AppSettings.updateOne({ key: "main" }, { $addToSet: { migrations: key } });
}

/**
 * Negociações de antes: quem criou = responsável atual.
 * Produtos de antes: o custo operacional vira uma linha de custo única.
 * Roda dentro de cada empresa que já existia (as novas nascem com as chaves marcadas).
 */
export async function migrateDealsAndProducts() {
  await once("lead-created-by-v1", async () => {
    // Direto na coleção (sem os hooks do plugin): o filtro da empresa vai à mão.
    await Lead.collection.updateMany({ createdBy: { $exists: false }, ...orgFilter() }, [{ $set: { createdBy: "$ownerId" } }]);
  });
  await once("product-costs-v1", async () => {
    await Product.collection.updateMany({ costs: { $exists: false }, ...orgFilter() }, [
      {
        $set: {
          category: { $ifNull: ["$category", ""] },
          costs: {
            $cond: [{ $gt: ["$operationalCost", 0] }, [{ label: "Custo operacional", value: "$operationalCost" }], []],
          },
        },
      },
    ]);
  });
}
