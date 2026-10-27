import { join, resolve } from "node:path";
import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { FileCallLog, FileModelCache, FileSpendLedger, MetaProvider } from "@forkcheck/ai";

const workspace = resolve(import.meta.dirname, "../../..");

/** The live Meta provider, behind LIVE=1, the spend cap, the call log and the response cache. */
export function liveMeta(): MetaProvider {
  loadLocalEnvFile();
  let env;
  try {
    env = loadEnv(process.env, { require: ["MODEL_API_KEY"] });
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  if (!env.LIVE) {
    console.error("Refusing to call the live API: set LIVE=1.");
    process.exit(1);
  }
  return new MetaProvider({
    apiKey: env.MODEL_API_KEY ?? "",
    spendCapUsd: env.SPEND_CAP_USD,
    ledger: new FileSpendLedger(join(workspace, "var", "spend.json")),
    log: new FileCallLog(join(workspace, "var", "model-calls.jsonl")),
    // Reruns of an unchanged prompt on unchanged scenarios cost nothing.
    cache: new FileModelCache(join(workspace, "var", "model-cache")),
  });
}
