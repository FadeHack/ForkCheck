/**
 * One live call through MetaProvider, using the real spend ledger and call log under var/.
 * Usage: LIVE=1 pnpm smoke:model
 */
import { join } from "node:path";
import { EnvError, findWorkspaceRoot, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import {
  ConsoleCallLog,
  FileCallLog,
  FileSpendLedger,
  MetaProvider,
  MultiCallLog,
  simulateOutput,
  stageConfig,
} from "../src/index";

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
const ledger = new FileSpendLedger(join(root, "var", "spend.json"));
const before = await ledger.totalUsd("meta");
const meta = new MetaProvider({
  apiKey: env.MODEL_API_KEY ?? "",
  spendCapUsd: env.SPEND_CAP_USD,
  ledger,
  log: new MultiCallLog(
    new ConsoleCallLog(),
    new FileCallLog(join(root, "var", "model-calls.jsonl")),
  ),
});

const { output, call } = await meta.call({
  stage: "simulateAnswer",
  promptVersion: "smoke.v1",
  reasoningEffort: stageConfig.simulateAnswer.reasoningEffort,
  schema: simulateOutput,
  messages: [
    {
      role: "developer",
      content:
        "You are a meeting participant. Your private understanding: the report is due Friday " +
        "and must include the Q3 numbers. Answer the question with one option ID, or null if unsure.",
    },
    {
      role: "user",
      content:
        'Question: When the report is "done", which is included?\n' +
        "Options:\n- o1: A draft outline\n- o2: The full report with Q3 numbers\n- o3: Slides only",
    },
  ],
});

const after = await ledger.totalUsd("meta");
console.log(JSON.stringify({ output, call }, null, 2));
console.log(
  `Ledger: $${before.toFixed(5)} -> $${after.toFixed(5)} (added $${(after - before).toFixed(5)}, ` +
    `logged $${call.costUsd.toFixed(5)})`,
);
if (Math.abs(after - before - call.costUsd) > 1e-9) process.exitCode = 1;
