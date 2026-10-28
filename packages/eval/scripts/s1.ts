/**
 * S1 transcription metrics: WER, turn speaker accuracy and commitment survival.
 * Usage: [LIVE=1] pnpm eval:s1 <file.wav>... [--out <report.md>]
 * Each WAV needs a sibling <name>.truth.json. Responses are cached in var/audio/asr/, so only
 * WAVs without a cached response are transcribed, and only with LIVE=1.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scoreTranscription } from "../src/index";
import { loadAudioInput, loadScenarios } from "./audio-input";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" } },
});
if (positionals.length === 0) {
  console.error("Usage: [LIVE=1] pnpm eval:s1 <file.wav>... [--out <report.md>]");
  process.exit(2);
}

const scenarios = loadScenarios();
let spentUsd = 0;

const rows: string[] = [];
const lostLines: string[] = [];
let humanVoices = false;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

for (const wavPath of positionals) {
  const { name, truth, scenario, response, costUsd } = await loadAudioInput(wavPath, scenarios);
  spentUsd += costUsd;
  humanVoices ||= Object.values(truth.voices).includes("human");

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
  ...(humanVoices
    ? [
        "",
        "One human voice played every role in the human recordings, so their speaker accuracy is a harder-than-real test of diarization.",
      ]
    : []),
  "",
].join("\n");
console.log(report);
if (spentUsd > 0) console.error(`Live transcription cost this run: $${spentUsd.toFixed(5)}`);
if (values.out) writeFileSync(values.out, report);
