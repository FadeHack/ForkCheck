import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TranscribeClient } from "@forkcheck/asr";
import { EnvError, loadEnv, loadLocalEnvFile, type Env } from "@forkcheck/config";
import { FileCallLog, FileModelCache, FileSpendLedger, MetaProvider } from "@forkcheck/ai";
import { BasetenProvider } from "@forkcheck/ai/baseten";

const workspace = resolve(import.meta.dirname, "../../..");

/** The environment for a live run; exits unless LIVE=1 and the provider's key is set. */
function liveEnv(key: "MODEL_API_KEY" | "BASETEN_API_KEY" = "MODEL_API_KEY"): Env {
  loadLocalEnvFile();
  let env: Env;
  try {
    env = loadEnv(process.env, { require: [key] });
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  if (!env.LIVE) {
    console.error("Refusing to call the live API: set LIVE=1.");
    process.exit(1);
  }
  return env;
}

/** Live Voice Transcribe, billed to the same Meta ledger, logged to var/transcribe-calls.jsonl. */
export function liveTranscriber(): TranscribeClient {
  const env = liveEnv();
  const logPath = join(workspace, "var", "transcribe-calls.jsonl");
  return new TranscribeClient({
    apiKey: env.MODEL_API_KEY ?? "",
    spendCapUsd: env.SPEND_CAP_USD,
    ledger: new FileSpendLedger(join(workspace, "var", "spend.json")),
    log: {
      write: async (entry) => {
        await mkdir(join(workspace, "var"), { recursive: true });
        await appendFile(logPath, `${JSON.stringify(entry)}\n`);
      },
    },
  });
}

/**
 * The live Meta provider, behind LIVE=1, the spend cap, the call log and the response cache.
 * Eval runs pass `cache: false`: repeated runs must sample the model, not replay it.
 */
export function liveMeta({ cache = true }: { cache?: boolean } = {}): MetaProvider {
  const env = liveEnv();
  return new MetaProvider({
    apiKey: env.MODEL_API_KEY ?? "",
    spendCapUsd: env.SPEND_CAP_USD,
    ledger: new FileSpendLedger(join(workspace, "var", "spend.json")),
    log: new FileCallLog(join(workspace, "var", "model-calls.jsonl")),
    // Reruns of an unchanged prompt on unchanged scenarios cost nothing.
    ...(cache ? { cache: new FileModelCache(join(workspace, "var", "model-cache")) } : {}),
  });
}

/** Muse Spark Open on Baseten for the comparison: its own cap, the shared ledger and call log, no cache. */
export function liveBaseten(): BasetenProvider {
  const env = liveEnv("BASETEN_API_KEY");
  return new BasetenProvider({
    apiKey: env.BASETEN_API_KEY ?? "",
    spendCapUsd: env.BASETEN_SPEND_CAP_USD,
    ledger: new FileSpendLedger(join(workspace, "var", "spend.json")),
    log: new FileCallLog(join(workspace, "var", "model-calls.jsonl")),
  });
}
