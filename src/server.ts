import { env } from "./config/env";
import { connectToDatabase } from "./config/db";
import { seedAdminUser } from "./lib/seedAdmin";
import { seedDefaultFunnel } from "./lib/seedDefaultFunnel";
import { seedFinancialCategories } from "./lib/seedFinancialCategories";
import { app } from "./app";

async function bootstrap() {
  await connectToDatabase();
  await seedAdminUser();
  await seedDefaultFunnel();
  await seedFinancialCategories();

  app.listen(env.port, () => {
    console.log(`Noma API running on http://localhost:${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
