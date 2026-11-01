import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TranscribeClient } from "@forkcheck/asr";
import { EnvError, loadEnv, loadLocalEnvFile, type Env } from "@forkcheck/config";
import {
  FileCallLog,
  FileModelCache,
  FileSpendLedger,
  MetaProvider,
  type ModelCallLog,
} from "@forkcheck/ai";
import { BasetenProvider } from "@forkcheck/ai/baseten";

const workspace = resolve(import.meta.dirname, "../../..");

// One ledger per process: its write queue only serializes updates made through the same instance.
let ledger: FileSpendLedger | undefined;
const spendLedger = () => (ledger ??= new FileSpendLedger(join(workspace, "var", "spend.json")));

/** The shared call log, plus an extra sink when a run needs its own copy of the entries. */
function callLog(extra?: ModelCallLog): ModelCallLog {
  const file = new FileCallLog(join(workspace, "var", "model-calls.jsonl"));
  if (!extra) return file;
  return { write: async (e) => void (await Promise.all([file.write(e), extra.write(e)])) };
}

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
    ledger: spendLedger(),
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
export function liveMeta({
  cache = true,
  log,
}: { cache?: boolean; log?: ModelCallLog } = {}): MetaProvider {
  const env = liveEnv();
  return new MetaProvider({
    apiKey: env.MODEL_API_KEY ?? "",
    spendCapUsd: env.SPEND_CAP_USD,
    ledger: spendLedger(),
    log: callLog(log),
    // Reruns of an unchanged prompt on unchanged scenarios cost nothing.
    ...(cache ? { cache: new FileModelCache(join(workspace, "var", "model-cache")) } : {}),
  });
}

/** Muse Spark Open on Baseten for the comparison: its own cap, the shared ledger and call log, no cache. */
export function liveBaseten({ log }: { log?: ModelCallLog } = {}): BasetenProvider {
  const env = liveEnv("BASETEN_API_KEY");
  return new BasetenProvider({
    apiKey: env.BASETEN_API_KEY ?? "",
    spendCapUsd: env.BASETEN_SPEND_CAP_USD,
    ledger: spendLedger(),
    log: callLog(log),
  });
}

/** Spent so far and the in-app cap, per provider, from the shared ledger and the environment. */
export async function spendStatus(): Promise<
  Record<"meta" | "baseten", { spent: number; cap: number }>
> {
  loadLocalEnvFile();
  const env = loadEnv(process.env);
  return {
    meta: { spent: await spendLedger().totalUsd("meta"), cap: env.SPEND_CAP_USD },
    baseten: { spent: await spendLedger().totalUsd("baseten"), cap: env.BASETEN_SPEND_CAP_USD },
  };
}
