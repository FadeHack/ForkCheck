/**
 * The R§7 eval run.
 * Usage:
 *   LIVE=1 pnpm eval:run [--runs 1] [--conditions <list>] [--scenarios <ids>] [--run-id <id>]
 *                        [--concurrency 4] [--plan-runs 3] [--synthetic <dir>] [--human <dir>]
 * Conditions (default: all four):
 *   meta-paste-precise, meta-paste-vague   full loop on the 26 scenarios, Muse Spark
 *   meta-audio-precise                     full loop on the 10-file audio set
 *   baseten-paste-precise                  detection half on the 26 scenarios, Spark Open for
 *                                          every stage but the simulator
 * Logs every scenario run to eval-results/<run-id>/logs/ and full traces to var/eval/<run-id>/.
 * Passing an existing `--run-id` resumes it and skips logged runs. A run that throws is logged
 * with its calls and scored as empty; hitting a spend cap stops the whole run.
 * At the end, writes cost.md: spend per condition and the projected cost of `--plan-runs` runs.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SpendCapError, type ModelCallEntry as LoggedCall, type ModelPort } from "@forkcheck/ai";
import type { Segment } from "@forkcheck/core";
import {
  AUDIO_SET,
  audioSegments,
  probeRounds,
  routeStages,
  runLog,
  runLogFromError,
  runLogFromLoop,
  runLogFromRounds,
  runLoop,
  type RunLog,
  type Scenario,
} from "../src/index";
import { loadAudioInput, loadScenarios } from "./audio-input";
import { liveBaseten, liveMeta, spendStatus } from "./live";

const workspace = resolve(import.meta.dirname, "../../..");
const CONDITIONS = [
  "meta-paste-precise",
  "meta-paste-vague",
  "meta-audio-precise",
  "baseten-paste-precise",
] as const;
type Condition = (typeof CONDITIONS)[number];
const usage =
  "Usage: LIVE=1 pnpm eval:run [--runs 1] [--conditions a,b] [--scenarios a,b] [--run-id id] " +
  "[--concurrency 4] [--plan-runs 3] [--synthetic dir] [--human dir]";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    conditions: { type: "string", default: CONDITIONS.join(",") },
    scenarios: { type: "string" },
    "run-id": { type: "string" },
    concurrency: { type: "string", default: "4" },
    "plan-runs": { type: "string", default: "3" },
    synthetic: { type: "string", default: join(workspace, "var", "audio", "synthetic") },
    human: { type: "string", default: join(workspace, "var", "audio", "human") },
  },
});
const runs = Number(values.runs);
const concurrency = Number(values.concurrency);
const planRuns = Number(values["plan-runs"]);
const conditions = values.conditions.split(",") as Condition[];
const only = values.scenarios ? new Set(values.scenarios.split(",")) : null;
if (
  ![runs, concurrency, planRuns].every((n) => Number.isInteger(n) && n >= 1) ||
  !conditions.every((c) => CONDITIONS.includes(c))
) {
  console.error(usage);
  process.exit(2);
}

// Every call a job makes, collected per job even with several jobs in flight.
const tap = new AsyncLocalStorage<LoggedCall[]>();
const log = { write: async (e: LoggedCall) => void tap.getStore()?.push(e) };
const needs = (provider: string) => conditions.some((c) => c.startsWith(provider));
const meta = liveMeta({ cache: false, log });
const open = needs("baseten") ? liveBaseten({ log }) : null;

const runId =
  values["run-id"] ??
  `m7-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}`;
const dir = join(workspace, "eval-results", runId);
const traces = join(workspace, "var", "eval", runId);
mkdirSync(join(dir, "logs"), { recursive: true });
mkdirSync(traces, { recursive: true });

const scenarios = loadScenarios();
const pasteSet = [...scenarios.values()]
  .filter((s) => /^(dev|heldout)-/.test(s.id))
  .sort((a, b) => a.id.localeCompare(b.id));
if (pasteSet.length !== 26) throw new Error(`expected 26 scenarios, found ${pasteSet.length}`);

interface Job {
  condition: Condition;
  run: number;
  name: string;
  scenario: Scenario;
  audio?: string;
}

const jobs: Job[] = [];
for (let run = 0; run < runs; run++) {
  for (const condition of conditions) {
    if (condition === "meta-audio-precise") {
      for (const entry of AUDIO_SET) {
        const file = resolve(
          entry.source === "human" ? values.human : values.synthetic,
          entry.file,
        );
        const scenario = scenarios.get(entry.scenarioId);
        if (!scenario) throw new Error(`no scenario ${entry.scenarioId}`);
        if (!only || only.has(scenario.id))
          jobs.push({ condition, run, name: basename(file, ".wav"), scenario, audio: file });
      }
    } else {
      for (const scenario of pasteSet)
        if (!only || only.has(scenario.id))
          jobs.push({ condition, run, name: scenario.id, scenario });
    }
  }
}
const logFile = (j: Job) => join(dir, "logs", `${j.condition}.${j.name}.run${j.run}.json`);
const pending = jobs.filter((j) => !existsSync(logFile(j)));
console.log(
  `${runId}: ${pending.length} of ${jobs.length} scenario runs to go, ${concurrency} at a time`,
);

async function runJob(j: Job): Promise<RunLog> {
  const ids = { runId, run: j.run };
  if (j.condition === "baseten-paste-precise") {
    const model = routeStages(open!, { simulateAnswer: meta });
    const r = await probeRounds(j.scenario, model);
    writeTrace(j, r);
    return runLogFromRounds({ ...ids, provider: "baseten" }, j.scenario.id, "paste", r);
  }
  let segments: Segment[] | undefined;
  if (j.audio) {
    const input = await loadAudioInput(j.audio, scenarios);
    segments = audioSegments(j.scenario, input.truth, input.response).segments;
  }
  const resolution = j.condition === "meta-paste-vague" ? "vague" : "precise";
  const result = await runLoop(j.scenario, meta satisfies ModelPort, {
    resolution,
    ...(segments ? { segments } : {}),
  });
  writeTrace(j, result.trace);
  return runLogFromLoop({ ...ids, provider: "meta" }, result);
}

function writeTrace(j: Job, trace: unknown) {
  const file = join(traces, `${j.condition}.${j.name}.run${j.run}.trace.json`);
  writeFileSync(file, `${JSON.stringify(trace, null, 2)}\n`);
}

let stopped: unknown = null;
async function work(): Promise<void> {
  for (let j = pending.shift(); j && !stopped; j = pending.shift()) {
    const calls: LoggedCall[] = [];
    let entry: RunLog;
    try {
      entry = await tap.run(calls, () => runJob(j));
    } catch (error) {
      if (error instanceof SpendCapError) {
        stopped = error;
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      entry = runLogFromError(
        { runId, run: j.run, provider: j.condition.startsWith("baseten") ? "baseten" : "meta" },
        {
          scenario: j.scenario.id,
          source: j.audio ? "audio" : "paste",
          resolution: j.condition === "meta-paste-vague" ? "vague" : "precise",
          depth: j.condition.startsWith("baseten") ? "detect" : "loop",
        },
        calls,
        message,
      );
    }
    writeFileSync(logFile(j), `${JSON.stringify(runLog.parse(entry), null, 2)}\n`);
    const cost = calls.reduce((t, c) => t + c.costUsd, 0);
    console.log(
      `${j.condition} run ${j.run} ${j.name}: ${calls.length} calls, $${cost.toFixed(4)}` +
        (entry.error ? `  FAILED ${entry.error.slice(0, 120)}` : ""),
    );
  }
}

await Promise.all(Array.from({ length: concurrency }, work));
if (stopped) console.error(`Stopped: ${(stopped as Error).message}`);

// Cost so far and the projection for the planned final run, by the provider billed.
const logs = readdirSync(join(dir, "logs"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ f, l: runLog.parse(JSON.parse(readFileSync(join(dir, "logs", f), "utf8"))) }));
const status = await spendStatus();
const planned: Record<Condition, number> = {
  "meta-paste-precise": 26,
  "meta-paste-vague": 26,
  "meta-audio-precise": AUDIO_SET.length,
  "baseten-paste-precise": 26,
};
const lines = [
  `# Cost: ${runId}`,
  "",
  "| Condition | Runs logged | Failed | Meta $ | Baseten $ | $ per meeting | Projected $ for " +
    `${planRuns} runs |`,
  "| --- | --- | --- | --- | --- | --- | --- |",
];
const projected = { meta: 0, baseten: 0 };
for (const c of CONDITIONS) {
  const group = logs.filter(({ f }) => f.startsWith(`${c}.`)).map(({ l }) => l);
  if (group.length === 0) continue;
  const calls = group.flatMap((l) => l.stages.flatMap((s) => s.calls));
  const by = (p: string) =>
    calls.filter((x) => x.provider === p).reduce((t, x) => t + x.costUsd, 0);
  const meetings = planned[c] * planRuns;
  projected.meta += (by("meta") / group.length) * meetings;
  projected.baseten += (by("baseten") / group.length) * meetings;
  const total = by("meta") + by("baseten");
  lines.push(
    `| ${c} | ${group.length} | ${group.filter((l) => l.error).length} | ${by("meta").toFixed(2)} | ` +
      `${by("baseten").toFixed(2)} | ${(total / group.length).toFixed(3)} | ` +
      `${((total / group.length) * meetings).toFixed(2)} |`,
  );
}
lines.push("", "| Provider | Spent (ledger) | Cap | Left | Projected final run | Fits |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const p of ["meta", "baseten"] as const) {
  const { spent, cap } = status[p];
  const left = cap - spent;
  lines.push(
    `| ${p} | ${spent.toFixed(2)} | ${cap.toFixed(2)} | ${left.toFixed(2)} | ` +
      `${projected[p].toFixed(2)} | ${projected[p] <= left ? "yes" : "**no**"} |`,
  );
}
const md = `${lines.join("\n")}\n`;
writeFileSync(join(dir, "cost.md"), md);
console.log(`\n${md}\nWrote ${relative(process.cwd(), join(dir, "cost.md"))}`);
process.exit(stopped ? 1 : 0);
