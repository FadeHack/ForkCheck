/**
 * Question-quality gate G1 (R§6.5) on the dev set.
 * Usage:
 *   LIVE=1 pnpm gate [--runs 3] [--tier free] [--run-id <id>]
 *   pnpm gate --from eval-results/g1/<run-id>
 * A live run asks each dev scenario's selected probes to simulated participants, `--runs`
 * times without the response cache, logging every scenario run to
 * eval-results/g1/<run-id>/logs/ and full traces to var/gate/<run-id>/. Passing an existing
 * `--run-id` resumes it and skips logged scenario runs. `--from` recomputes the verdict from
 * the logs alone. Either way the verdict is written to report.md next to the logs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { probeTier } from "@forkcheck/core";
import {
  gateLog,
  gateVerdict,
  parseScenario,
  probeRounds,
  renderGateReport,
  type GateLog,
} from "../src/index";
import { liveMeta } from "./live";

const workspace = resolve(import.meta.dirname, "../../..");
const usage =
  "Usage: LIVE=1 pnpm gate [--runs 3] [--tier free] [--run-id <id>] | pnpm gate --from <dir>";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    tier: { type: "string", default: "free" },
    "run-id": { type: "string" },
    from: { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
});
const runs = Number(values.runs);
const concurrency = Number(values.concurrency);
const parsedTier = probeTier.safeParse(values.tier);
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
  console.error(usage);
  process.exit(2);
}
if (!parsedTier.success) {
  console.error(`Unknown tier ${values.tier}. ${usage}`);
  process.exit(2);
}
const tier = parsedTier.data;

function readLogs(dir: string): GateLog[] {
  const logs = join(dir, "logs");
  return readdirSync(logs)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => gateLog.parse(JSON.parse(readFileSync(join(logs, f), "utf8"))));
}

function report(dir: string): boolean {
  const logs = readLogs(dir);
  const verdict = gateVerdict(logs);
  const md = renderGateReport(verdict, logs);
  writeFileSync(join(dir, "report.md"), md);
  console.log(md);
  console.log(`Wrote ${relative(process.cwd(), join(dir, "report.md"))}`);
  return verdict.go;
}

if (values.from) {
  report(resolve(values.from));
  process.exit(0);
}

const runId =
  values["run-id"] ??
  `g1-${tier}-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}`;
const dir = join(workspace, "eval-results", "g1", runId);
const traces = join(workspace, "var", "gate", runId);
mkdirSync(join(dir, "logs"), { recursive: true });
mkdirSync(traces, { recursive: true });

const devDir = join(workspace, "scenarios", "dev");
const dev = readdirSync(devDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => parseScenario(readFileSync(join(devDir, f), "utf8")));
const model = liveMeta({ cache: false });

const jobs = Array.from({ length: runs }, (_, run) => dev.map((s) => ({ run, s }))).flat();
const pending = jobs.filter(
  ({ run, s }) => !existsSync(join(dir, "logs", `${s.id}.run${run}.json`)),
);
console.log(
  `${runId}: ${pending.length} of ${jobs.length} scenario runs to go, tier ${tier}, ` +
    `${concurrency} at a time`,
);

async function work(): Promise<void> {
  for (let job = pending.shift(); job; job = pending.shift()) {
    const { run, s } = job;
    const r = await probeRounds(s, model, { tier: tier });
    const costUsd = r.stages.reduce((t, st) => t + st.calls.reduce((u, c) => u + c.costUsd, 0), 0);
    const log: GateLog = {
      runId,
      run,
      scenario: s.id,
      tier: tier,
      planted: s.plantedMismatches.map((m) => ({ id: m.id, dimension: m.dimension })),
      candidates: r.candidates.map(({ id, dimension, mismatch, probeId }) => ({
        id,
        dimension,
        mismatch,
        probeId,
      })),
      rounds: r.rounds.map(({ probeId, stem, divergence }) => ({
        probeId,
        stem,
        divergence: { outcome: divergence.outcome },
      })),
      costUsd,
    };
    const name = `${s.id}.run${run}`;
    writeFileSync(
      join(traces, `${name}.trace.json`),
      `${JSON.stringify({ candidates: r.candidates, selected: r.selected, rounds: r.rounds, stages: r.stages }, null, 2)}\n`,
    );
    writeFileSync(join(dir, "logs", `${name}.json`), `${JSON.stringify(log, null, 2)}\n`);
    const splits = log.rounds.filter((x) => x.divergence.outcome === "split").length;
    console.log(
      `run ${run} ${s.id}: ${log.rounds.length} probes, ${splits} splits, $${costUsd.toFixed(4)}`,
    );
  }
}

await Promise.all(Array.from({ length: concurrency }, work));
report(dir);
