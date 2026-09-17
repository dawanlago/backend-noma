import { env } from "./config/env";
import { bootstrapApp } from "./lib/bootstrap";
import { app } from "./app";

async function start() {
  await bootstrapApp();

  app.listen(env.port, () => {
    console.log(`Noma API running on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
