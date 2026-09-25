import { connectToDatabase } from "../config/db";
import { seedAdminUser } from "./seedAdmin";
import { seedLibrary } from "./seedLibrary";

let started: Promise<void> | null = null;

export function bootstrapApp() {
  if (!started) {
    started = (async () => {
      await connectToDatabase();
      await seedAdminUser();
      await seedLibrary();
    })();
  }

  return started;
}
