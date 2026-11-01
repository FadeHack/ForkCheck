/**
 * Scenario tooling.
 * Usage:
 *   pnpm eval validate [scenario files...]   (default: every scenario under scenarios/)
 *   pnpm eval audio-set [--synthetic <dir>] [--human <dir>]   (WAV checks on the 10-file audio set)
 *   pnpm eval sheets <run dir> [--seed <s>]  (blind rating sheets from <run>/logs, key kept apart)
 *   pnpm eval import-sheets <run dir>        (validates the completed sheets, writes human.json)
 *   pnpm eval report <run dir...> [--date YYYY-MM-DD]   (eval-results/<date>/report.md from run logs)
 *   LIVE=1 pnpm eval extract                 (extraction precision and recall on the dev set)
 *   LIVE=1 pnpm eval probes                  (candidates against planted gaps, T2 probes after lint and critic)
 *   LIVE=1 pnpm eval simulate                (simulated answers on the probes for planted gaps)
 *   LIVE=1 pnpm eval recheck                 (rechecks of scripted resolutions: catch and pass rates)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectWav } from "@forkcheck/asr";
import type { ModelPort } from "@forkcheck/ai";
import {
  divergence,
  optionOrder,
  stemOverlap,
  type DivergenceAnswer,
  type DivergenceOutcome,
  type Probe,
} from "@forkcheck/core";
import {
  extract,
  findCandidates,
  simulateAnswer,
  vetProbe,
  vetRecheck,
  type ParticipantBrief,
  type StageTrace,
} from "@forkcheck/engine";
import {
  aggregate,
  applyAdoptionRule,
  AUDIO_SET,
  buildSheets,
  importSheets,
  isSplit,
  parseCsv,
  lintScenario,
  parseScenario,
  recheckBriefs,
  renderReport,
  runLog,
  scenario,
  scenarioBriefs,
  scenarioExtractInput,
  scoreCandidates,
  scoreExtraction,
  SHEETS,
  sheetKey,
  summarizeRatings,
  summarizeScores,
  type ExtractScore,
  type HumanScores,
  type Scenario,
  type SheetKind,
} from "../src/index";
import { liveMeta } from "./live";

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

function devScenarios() {
  return allScenarioFiles()
    .filter((f) => relative(root, f).startsWith("dev"))
    .map((f) => parseScenario(readFileSync(f, "utf8")));
}

const traceCost = (trace: StageTrace) => trace.calls.reduce((t, c) => t + c.costUsd, 0);

async function extractDev(): Promise<boolean> {
  const model = liveMeta();
  const dev = devScenarios();
  const scores: ExtractScore[] = [];
  let cost = 0;
  for (const s of dev) {
    const { output, trace } = await extract(scenarioExtractInput(s), model);
    cost += traceCost(trace);
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

/** Extract, find candidates and vet one probe per candidate for a scenario. */
async function scenarioProbes(s: Scenario, model: ModelPort) {
  const input = scenarioExtractInput(s);
  const extracted = await extract(input, model);
  const { decisions } = extracted.output;
  const found = await findCandidates({ ...input, decisions }, model);
  const score = scoreCandidates(s, decisions, found.output.candidates);
  const byId = new Map(decisions.map((d) => [d.decision.id, d]));
  const vetted = [];
  for (const candidate of found.output.candidates) {
    const result = await vetProbe(
      {
        meeting: input.meeting,
        participants: input.participants,
        decision: byId.get(candidate.decisionId)!,
        candidate,
        tier: "free",
        segments: input.segments,
      },
      model,
    );
    vetted.push({ candidate, onPlanted: score.onPlanted.has(candidate.id), ...result });
  }
  const traces = [extracted.trace, found.trace, ...vetted.flatMap((v) => v.traces)];
  return {
    input,
    decisions: byId,
    score,
    candidateDrops: found.trace.drops,
    vetted,
    cost: traces.reduce((t, tr) => t + traceCost(tr), 0),
  };
}

async function probesDev(): Promise<boolean> {
  const model = liveMeta();
  let cost = 0;
  let planted = 0;
  let hit = 0;
  let candidates = 0;
  let generations = 0;
  let published = 0;
  let plantedPublished = 0;
  let plantedLost = 0;
  const dropReasons = new Map<string, number>();
  for (const s of devScenarios()) {
    const { score, candidateDrops, vetted, cost: c } = await scenarioProbes(s, model);
    cost += c;
    planted += score.hit.length + score.missed.length;
    hit += score.hit.length;
    candidates += score.candidates;
    console.log(
      `${s.id}: ${score.candidates} candidates, planted found ${score.hit.length}/` +
        `${score.hit.length + score.missed.length}`,
    );
    for (const id of score.missed) console.log(`  MISSED   ${id}`);
    for (const d of candidateDrops) console.log(`  dropped  ${d.reason}`);

    for (const { candidate, onPlanted, probe: p, traces, drops } of vetted) {
      generations += traces.filter((t) => t.stage === "generateProbes").length;
      for (const d of drops) {
        dropReasons.set(d.reason, (dropReasons.get(d.reason) ?? 0) + 1);
        const item = d.item as { probe?: { stem: string }; problems?: string[] };
        console.log(`  dropped  ${d.reason} [${candidate.dimension}] ${item.probe?.stem ?? ""}`);
        for (const x of item.problems ?? []) console.log(`      ${x}`);
      }
      if (!p) {
        if (onPlanted) plantedLost += 1;
        continue;
      }
      published += 1;
      if (onPlanted) plantedPublished += 1;
      console.log(`  ${onPlanted ? "*" : " "} [${candidate.dimension}] ${p.stem}`);
      for (const o of p.options) console.log(`      - ${o.text}`);
    }
  }
  console.log(
    `\nPlanted gaps found ${hit}/${planted}, candidates ${candidates}, ` +
      `generations ${generations}, published ${published} ` +
      `(on planted gaps ${plantedPublished}, planted lost ${plantedLost}), cost $${cost.toFixed(4)}`,
  );
  console.log(`Drops: ${[...dropReasons].map(([r, n]) => `${r} ${n}`).join(", ") || "none"}`);
  return true;
}

/** Simulated answers on every published probe that targets a planted gap. */
async function simulateDev(): Promise<boolean> {
  const model = liveMeta();
  let cost = 0;
  let probes = 0;
  let revealed = 0;
  for (const s of devScenarios()) {
    const { vetted, cost: c } = await scenarioProbes(s, model);
    cost += c;
    const briefs = scenarioBriefs(s);
    for (const { candidate, onPlanted, probe } of vetted) {
      if (!onPlanted || !probe) continue;
      const planted = s.plantedMismatches.find((m) => m.dimension === candidate.dimension)!;
      console.log(`${s.id} [${candidate.dimension}] ${probe.stem}`);
      const answers: (string | null)[] = [];
      for (const brief of briefs) {
        const shown = optionOrder(probe, brief.participantId);
        const { output, trace } = await simulateAnswer({ brief, probe: shown }, model);
        cost += traceCost(trace);
        const { optionId } = output.answer;
        answers.push(optionId);
        const text = probe.options.find((o) => o.id === optionId)?.text ?? "(not sure)";
        const reading = brief.readings.find(
          (r) => r.decisionId === planted.decision && r.dimension === planted.dimension,
        );
        console.log(`  ${brief.participantId}: ${text}`);
        console.log(`      brief: ${reading?.reading ?? "(none)"}`);
      }
      probes += 1;
      const split = isSplit(answers);
      if (split) revealed += 1;
      console.log(`  ${split ? "split" : "NO SPLIT"}`);
    }
  }
  console.log(
    `\nPlanted probes ${probes}, split among simulated participants ${revealed}, ` +
      `cost $${cost.toFixed(4)}`,
  );
  return true;
}

/** Every brief answers the probe in their own option order; returns the outcome and cost. */
async function simulateRound(probe: Probe, briefs: ParticipantBrief[], model: ModelPort) {
  const answers: DivergenceAnswer[] = [];
  let cost = 0;
  for (const brief of briefs) {
    const shown = optionOrder(probe, brief.participantId);
    const { output, trace } = await simulateAnswer({ brief, probe: shown }, model);
    cost += traceCost(trace);
    answers.push({
      participantId: brief.participantId,
      ...output.answer,
      writeInText: null,
      mappedOptionId: null,
    });
  }
  const ids = briefs.map((b) => b.participantId);
  return { answers, result: divergence(probe, ids, answers), cost };
}

/**
 * For each planted gap with a published probe, recheck the precise and the vague scripted
 * resolution. Catch rate: expected splits that split. Pass rate: expected consistent
 * rechecks that came out consistent.
 */
async function recheckDev(): Promise<boolean> {
  const model = liveMeta();
  let cost = 0;
  const tally = new Map<DivergenceOutcome, { hit: number; of: number }>();
  let dropped = 0;
  let regenerated = 0;
  const overlaps: number[] = [];
  for (const s of devScenarios()) {
    const { input, decisions, vetted, cost: c } = await scenarioProbes(s, model);
    cost += c;
    for (const scripted of s.scriptedResolutions) {
      const m = s.plantedMismatches.find((x) => x.id === scripted.mismatch)!;
      const original = vetted.find(
        (v) => v.onPlanted && v.probe && v.candidate.dimension === m.dimension,
      );
      if (!original?.probe) {
        console.log(`${s.id} ${m.id}: no published probe on the planted gap, skipped`);
        continue;
      }
      console.log(`${s.id} ${m.id}: ${original.probe.stem}`);
      for (const variant of ["precise", "vague"] as const) {
        const { text, expectedRecheck } = scripted[variant];
        const recheck = await vetRecheck(
          {
            decision: decisions.get(original.candidate.decisionId)!,
            originalProbe: original.probe,
            resolution: {
              id: `${m.id}-${variant}`,
              splitId: `${s.id}:${m.id}`,
              text,
              proposedBy: s.participants[0]!,
              draftedByModel: false,
              status: "confirmed",
            },
            segments: input.segments,
          },
          model,
        );
        cost += recheck.traces.reduce((t, tr) => t + traceCost(tr), 0);
        regenerated += recheck.drops.filter((d) => d.reason === "regenerated_after_lint").length;
        const t = tally.get(expectedRecheck) ?? { hit: 0, of: 0 };
        t.of += 1;
        tally.set(expectedRecheck, t);
        console.log(`  ${variant}: "${text}"`);
        for (const d of recheck.drops) {
          const item = d.item as { probe?: { stem: string }; problems?: string[] };
          console.log(`    dropped  ${d.reason} ${item.probe?.stem ?? ""}`);
          for (const x of item.problems ?? []) console.log(`        ${x}`);
        }
        if (!recheck.probe) {
          dropped += 1;
          console.log(`    NO RECHECK (expected ${expectedRecheck})`);
          continue;
        }
        const overlap = stemOverlap(recheck.probe.stem, original.probe.stem);
        overlaps.push(overlap);
        console.log(`    consequence: ${recheck.consequence}`);
        console.log(`    recheck: ${recheck.probe.stem} (overlap ${overlap.toFixed(2)})`);
        for (const o of recheck.probe.options) console.log(`        - ${o.text}`);
        const round = await simulateRound(recheck.probe, recheckBriefs(s, m.id, text), model);
        cost += round.cost;
        for (const a of round.answers) {
          const chosen = recheck.probe.options.find((o) => o.id === a.optionId)?.text;
          console.log(`      ${a.participantId}: ${chosen ?? "(not sure)"}`);
        }
        const outcome = round.result.outcome;
        if (outcome === expectedRecheck) t.hit += 1;
        console.log(
          `    ${outcome === expectedRecheck ? "ok" : "MISS"} ${outcome} (expected ${expectedRecheck})`,
        );
      }
    }
  }
  const rate = (o: DivergenceOutcome) => {
    const t = tally.get(o) ?? { hit: 0, of: 0 };
    return `${t.of === 0 ? "n/a" : `${((t.hit / t.of) * 100).toFixed(0)}%`} (${t.hit}/${t.of})`;
  };
  const maxOverlap = overlaps.length === 0 ? 0 : Math.max(...overlaps);
  console.log(
    `\nCatch rate ${rate("split")}, pass rate ${rate("consistent")}, ` +
      `rechecks regenerated ${regenerated}, dropped ${dropped}, ` +
      `max stem overlap ${maxOverlap.toFixed(2)}, cost $${cost.toFixed(4)}`,
  );
  return true;
}

/** Runs the upload checks on every file in the audio set; recordings live outside git. */
function checkAudioSet(args: string[]): boolean {
  const { values } = parseArgs({
    args,
    options: {
      synthetic: { type: "string", default: "var/audio/synthetic" },
      human: { type: "string", default: "var/audio/human" },
    },
  });
  let ok = true;
  for (const entry of AUDIO_SET) {
    const file = resolve(entry.source === "human" ? values.human : values.synthetic, entry.file);
    const name = relative(process.cwd(), file);
    if (!existsSync(file)) {
      ok = false;
      console.log(`miss  ${name}`);
      continue;
    }
    const report = inspectWav(readFileSync(file));
    ok &&= report.ok;
    console.log(
      report.ok
        ? `pass  ${name}  ${entry.source}`
        : `FAIL  ${name}  ${report.problems.map((p) => p.message).join(" ")}`,
    );
  }
  return ok;
}

/**
 * Writes the three blind sheets to `<run>/ratings/` and the item key to `<run>/ratings-key.json`,
 * outside the folder the rater opens.
 */
function writeSheets(args: string[]): boolean {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { seed: { type: "string", default: "forkcheck-m7" } },
  });
  const dir = positionals[0];
  if (!dir) {
    console.error("Usage: pnpm eval sheets <run dir>");
    return false;
  }
  const logsDir = join(dir, "logs");
  const logs = readdirSync(logsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => runLog.parse(JSON.parse(readFileSync(join(logsDir, f), "utf8"))));
  const scenarios = new Map(
    allScenarioFiles().map((f) => {
      const s = parseScenario(readFileSync(f, "utf8"));
      return [s.id, s];
    }),
  );
  const sheets = buildSheets(scenarios, logs, values.seed);
  mkdirSync(join(dir, "ratings"), { recursive: true });
  for (const kind of Object.keys(SHEETS) as SheetKind[]) {
    const file = join(dir, "ratings", SHEETS[kind].file);
    if (existsSync(file)) {
      console.error(`${file} exists; move it away before writing new sheets`);
      return false;
    }
    writeFileSync(file, sheets[kind]);
    console.log(`${file}  ${parseCsv(sheets[kind]).length - 1} rows`);
  }
  writeFileSync(join(dir, "ratings-key.json"), JSON.stringify(sheets.key, null, 2) + "\n");
  return true;
}

function importRatings(args: string[]): boolean {
  const dir = args[0];
  if (!dir) {
    console.error("Usage: pnpm eval import-sheets <run dir>");
    return false;
  }
  const key = sheetKey.parse(JSON.parse(readFileSync(join(dir, "ratings-key.json"), "utf8")));
  const completed = Object.fromEntries(
    (Object.keys(SHEETS) as SheetKind[]).map((k) => [
      k,
      readFileSync(join(dir, "ratings", SHEETS[k].file), "utf8"),
    ]),
  ) as Record<SheetKind, string>;
  const { ratings, problems } = importSheets(completed, key);
  if (problems.length > 0) {
    for (const p of problems) console.log(`FAIL  ${p}`);
    return false;
  }
  const summary = summarizeRatings(ratings, key);
  writeFileSync(join(dir, "human.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`${ratings.length} ratings imported; ${join(dir, "human.json")}`);
  return true;
}

/**
 * Aggregates the logs of the given run directories into eval-results/<date>/report.md, with
 * the adoption rule when both providers ran and the human scores of any imported human.json.
 */
function writeReport(args: string[]): boolean {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { date: { type: "string", default: new Date().toISOString().slice(0, 10) } },
  });
  if (positionals.length === 0) {
    console.error("Usage: pnpm eval report <run dir...> [--date YYYY-MM-DD]");
    return false;
  }
  const scenarios = new Map(
    allScenarioFiles().map((f) => {
      const s = parseScenario(readFileSync(f, "utf8"));
      return [s.id, s];
    }),
  );
  const logs = positionals.flatMap((dir) =>
    readdirSync(join(dir, "logs"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => runLog.parse(JSON.parse(readFileSync(join(dir, "logs", f), "utf8")))),
  );
  const conditions = aggregate(scenarios, logs);
  const spark = conditions.find((c) => c.condition === "meta/paste/precise");
  const open = conditions.find((c) => c.condition === "baseten/paste/precise");
  const humanFiles = positionals.map((d) => join(d, "human.json")).filter(existsSync);
  const human = humanFiles.length
    ? humanFiles.flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as HumanScores[])
    : null;
  const md = renderReport({
    date: values.date,
    conditions,
    adoption: spark && open ? applyAdoptionRule(spark, open) : null,
    human,
  });
  const out = resolve(root, "..", "eval-results", values.date);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.md"), md);
  console.log(
    `${logs.length} scenario runs in ${conditions.length} conditions; ${join(out, "report.md")}`,
  );
  return true;
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "validate": {
    const files = args.length > 0 ? args.map((f) => resolve(f)) : allScenarioFiles();
    process.exit(validate(files) ? 0 : 1);
    break;
  }
  case "audio-set":
    process.exit(checkAudioSet(args) ? 0 : 1);
    break;
  case "report":
    process.exit(writeReport(args) ? 0 : 1);
    break;
  case "sheets":
    process.exit(writeSheets(args) ? 0 : 1);
    break;
  case "import-sheets":
    process.exit(importRatings(args) ? 0 : 1);
    break;
  case "extract":
    process.exit((await extractDev()) ? 0 : 1);
    break;
  case "probes":
    process.exit((await probesDev()) ? 0 : 1);
    break;
  case "simulate":
    process.exit((await simulateDev()) ? 0 : 1);
    break;
  case "recheck":
    process.exit((await recheckDev()) ? 0 : 1);
    break;
  default:
    console.error(
      "Usage: pnpm eval validate [files...] | audio-set | sheets <run> | import-sheets <run> | report <run...> | LIVE=1 pnpm eval extract | probes | simulate | recheck",
    );
    process.exit(2);
}
