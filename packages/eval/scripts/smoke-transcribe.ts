/**
 * One live transcription of the M0.5 probe audio through TranscribeClient, billed to the
 * shared Meta spend ledger under var/.
 * Usage: LIVE=1 pnpm smoke:transcribe
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FileSpendLedger } from "@forkcheck/ai";
import { EnvError, findWorkspaceRoot, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { TranscribeClient, TranscribeError } from "@forkcheck/asr";
import { renderProbeWav } from "../../asr/scripts/probe-audio";
import { checkResponse, probeScript } from "../../asr/scripts/transcribe-probe-checks";

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

const root = findWorkspaceRoot() ?? process.cwd();
const logPath = join(root, "var", "transcribe-calls.jsonl");
await mkdir(join(root, "var"), { recursive: true });
const client = new TranscribeClient({
  apiKey: env.MODEL_API_KEY ?? "",
  spendCapUsd: env.SPEND_CAP_USD,
  ledger: new FileSpendLedger(join(root, "var", "spend.json")),
  log: {
    write: async (entry) => {
      console.error(`[transcribe] ${JSON.stringify(entry)}`);
      await appendFile(logPath, `${JSON.stringify(entry)}\n`);
    },
  },
});

const { wavBytes, fileDurationMs } = renderProbeWav();
try {
  const result = await client.transcribe(wavBytes, {
    keywords: [...new Set(probeScript.map((l) => l.speaker))],
  });
  const r = result.response;
  console.log(
    `session ${r.sessionId}: ${r.audioDurationMs} ms audio, ${result.latencyMs} ms, ` +
      `${result.attempts} attempt(s), $${result.costUsd.toFixed(5)}`,
  );
  for (const t of r.turns) {
    console.log(`  ${t.speaker ?? "?"} ${t.startMs}-${t.endMs}: ${t.transcript}`);
  }
  const report = checkResponse(r, fileDurationMs);
  for (const c of report.checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.name}: ${c.detail}`);
  if (report.checks.some((c) => !c.ok)) process.exitCode = 1;
} catch (error) {
  if (!(error instanceof TranscribeError)) throw error;
  console.error(`${error.message}\nUser message: ${error.userMessage}`);
  process.exitCode = 1;
}
