/**
 * Scenario tooling.
 * Usage:
 *   pnpm eval validate [scenario files...]   (default: every scenario under scenarios/)
 *   LIVE=1 pnpm eval extract                 (extraction precision and recall on the dev set)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { FileCallLog, FileModelCache, FileSpendLedger, MetaProvider } from "@forkcheck/ai";
import { extract } from "@forkcheck/engine";
import {
  lintScenario,
  parseScenario,
  scenario,
  scenarioExtractInput,
  scoreExtraction,
  summarizeScores,
  type ExtractScore,
} from "../src/index";

const root = resolve(import.meta.dirname, "../../../scenarios");

function allScenarioFiles(): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json") && !f.startsWith("audio"))
    .sort()
    .map((f) => join(root, f));
}

function validate(files: string[]): boolean {
  let ok = true;
  for (const file of files) {
    const name = relative(process.cwd(), file);
    const problems: string[] = [];
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (problems.length === 0) {
      const parsed = scenario.safeParse(json);
      if (parsed.success) {
        for (const issue of lintScenario(parsed.data)) {
          problems.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      } else {
        for (const issue of parsed.error.issues) {
          problems.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    }
    if (problems.length === 0) {
      console.log(`ok    ${name}`);
    } else {
      ok = false;
      console.log(`FAIL  ${name}`);
      for (const p of problems) console.log(`      ${p}`);
    }
  }
  return ok;
}

function liveMeta(): MetaProvider {
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
  const workspace = resolve(root, "..");
  return new MetaProvider({
    apiKey: env.MODEL_API_KEY ?? "",
    spendCapUsd: env.SPEND_CAP_USD,
    ledger: new FileSpendLedger(join(workspace, "var", "spend.json")),
    log: new FileCallLog(join(workspace, "var", "model-calls.jsonl")),
    // Reruns of an unchanged prompt on unchanged scenarios cost nothing.
    cache: new FileModelCache(join(workspace, "var", "model-cache")),
  });
}

async function extractDev(): Promise<boolean> {
  const model = liveMeta();
  const dev = allScenarioFiles()
    .filter((f) => relative(root, f).startsWith("dev"))
    .map((f) => parseScenario(readFileSync(f, "utf8")));
  const scores: ExtractScore[] = [];
  let cost = 0;
  for (const s of dev) {
    const { output, trace } = await extract(scenarioExtractInput(s), model);
    cost += trace.calls.reduce((t, c) => t + c.costUsd, 0);
    const score = scoreExtraction(s, output.decisions);
    scores.push(score);
    console.log(
      `${s.id}: matched ${score.matched}/${score.expected}, extracted ${score.extracted}, ` +
        `quote drops ${trace.drops.length}, inferred flags ${score.inferredFlags}`,
    );
    for (const id of score.missed) console.log(`  missed   ${id}`);
    for (const text of score.extra) console.log(`  extra    ${text}`);
    for (const i of score.invented)
      console.log(`  INVENTED ${i.field} "${i.value}" on ${i.decision}`);
    for (const i of score.differs)
      console.log(`  differs  ${i.field} "${i.value}" on ${i.decision}`);
    for (const d of trace.drops) console.log(`  dropped  ${d.reason}`);
  }
  const total = summarizeScores(scores);
  console.log(
    `\nPrecision ${(total.precision * 100).toFixed(0)}% (${total.matched}/${total.extracted}), ` +
      `recall ${(total.recall * 100).toFixed(0)}% (${total.matched}/${total.expected}), ` +
      `invented owners or dates ${total.invented}, differ from key ${total.differs}, ` +
      `cost $${cost.toFixed(4)}`,
  );
  return total.invented === 0;
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "validate": {
    const files = args.length > 0 ? args.map((f) => resolve(f)) : allScenarioFiles();
    process.exit(validate(files) ? 0 : 1);
    break;
  }
  case "extract":
    process.exit((await extractDev()) ? 0 : 1);
    break;
  default:
    console.error("Usage: pnpm eval validate [scenario files...] | LIVE=1 pnpm eval extract");
    process.exit(2);
}
