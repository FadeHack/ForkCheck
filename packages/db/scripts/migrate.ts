import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { migrateDatabase } from "../src/index";

loadLocalEnvFile();

try {
  const env = loadEnv(process.env, { require: ["DATABASE_URL"] });
  await migrateDatabase(env.DATABASE_URL!);
  console.log("Migrations applied");
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
