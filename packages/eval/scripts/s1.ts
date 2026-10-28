/**
 * S1 transcription metrics: WER, turn speaker accuracy and commitment survival.
 * Usage: [LIVE=1] pnpm eval:s1 <file.wav>... [--out <report.md>]
 * Each WAV needs a sibling <name>.truth.json. Responses are cached in var/audio/asr/, so only
 * WAVs without a cached response are transcribed, and only with LIVE=1.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { transcribeResponse, type TranscribeResponse } from "@forkcheck/asr";
import { audioTruth, parseScenario, scoreTranscription, type Scenario } from "../src/index";
import { liveTranscriber } from "./live";

const workspace = resolve(import.meta.dirname, "../../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" } },
});
if (positionals.length === 0) {
  console.error("Usage: [LIVE=1] pnpm eval:s1 <file.wav>... [--out <report.md>]");
  process.exit(2);
}

const scenarios = new Map<string, Scenario>();
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".json") ? [join(dir, e.name)] : [],
  );
for (const file of walk(join(workspace, "scenarios"))) {
  try {
    const s = parseScenario(readFileSync(file, "utf8"));
    scenarios.set(s.id, s);
  } catch {
    // Not a scenario file (fixtures, samples in another format).
  }
}

const cacheDir = join(workspace, "var", "audio", "asr");
mkdirSync(cacheDir, { recursive: true });
let client: ReturnType<typeof liveTranscriber> | undefined;
let spentUsd = 0;

const rows: string[] = [];
const lostLines: string[] = [];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

for (const wavPath of positionals) {
  const name = basename(wavPath, ".wav");
  const truth = audioTruth.parse(
    JSON.parse(readFileSync(join(dirname(wavPath), `${name}.truth.json`), "utf8")),
  );
  const scenario = scenarios.get(truth.scenarioId);
  if (!scenario) throw new Error(`no scenario with id ${truth.scenarioId}`);

  const cached = join(cacheDir, `${name}.json`);
  let response: TranscribeResponse;
  if (existsSync(cached)) {
    response = transcribeResponse.parse(JSON.parse(readFileSync(cached, "utf8")));
  } else {
    client ??= liveTranscriber();
    const result = await client.transcribe(readFileSync(wavPath), {
      keywords: scenario.participants,
    });
    spentUsd += result.costUsd;
    response = result.response;
    writeFileSync(cached, JSON.stringify(response, null, 2) + "\n");
    console.error(`transcribed ${name}: ${result.latencyMs} ms, $${result.costUsd.toFixed(5)}`);
  }

  const r = scoreTranscription(scenario, truth, response.turns);
  const mapping = Object.entries(r.speakers.mapping)
    .map(([label, person]) => `${label}→${person ?? "none"}`)
    .join(", ");
  rows.push(
    `| ${name} | ${truth.variant} | ${(truth.durationMs / 1000).toFixed(1)} s | ` +
      `${pct(r.wer.wer)} (S${r.wer.substitutions} D${r.wer.deletions} I${r.wer.insertions}) | ` +
      `${pct(r.speakers.accuracy)} (${r.speakers.correct}/${r.speakers.total}) | ` +
      `${pct(r.commitments.survival)} (${r.commitments.survived}/${r.commitments.total}) | ${mapping} |`,
  );
  if (r.commitments.lost.length) {
    lostLines.push(
      `- ${name}: ${r.commitments.lost.map((t) => `${t.term} (${t.kind}, ${t.speaker}, turn ${t.scriptIdx})`).join("; ")}`,
    );
  }
}

const report = [
  "| Audio | Variant | Length | WER | Speaker accuracy | Commitment survival | Labels |",
  "|---|---|---|---|---|---|---|",
  ...rows,
  "",
  lostLines.length ? "Lost commitment terms:" : "No commitment terms lost.",
  ...lostLines,
  "",
].join("\n");
console.log(report);
if (spentUsd > 0) console.error(`Live transcription cost this run: $${spentUsd.toFixed(5)}`);
if (values.out) writeFileSync(values.out, report);
