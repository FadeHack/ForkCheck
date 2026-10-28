/**
 * The headless loop on one scenario.
 * Usage:
 *   pnpm loop <scenario.json> [--resolution precise|vague] [--provider meta|fake] [--record-fixtures]
 *   pnpm loop --audio <rendered.wav> [same options]
 * `--audio` transcribes the WAV (or reuses var/audio/asr/), maps speakers from its truth file
 * as an organizer would, and runs the loop on those segments.
 * `fake` (the default) replays fixtures and costs nothing. `meta` needs LIVE=1;
 * `--record-fixtures` saves its responses so `fake` can replay the run.
 * Writes var/loop/<scenario>-<resolution>[-audio]/{trace.json,record.json,record.md}.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FakeProvider, RecordingProvider, type ModelPort } from "@forkcheck/ai";
import {
  audioSegments,
  parseScenario,
  renderRecordMarkdown,
  runLoop,
  type ResolutionVariant,
  type Scenario,
} from "../src/index";
import type { Segment } from "@forkcheck/core";
import { loadAudioInput, loadScenarios } from "./audio-input";
import { liveMeta } from "./live";

const usage =
  "Usage: pnpm loop <scenario.json | --audio rendered.wav> [--resolution precise|vague] [--provider meta|fake] [--record-fixtures]";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    resolution: { type: "string", default: "precise" },
    provider: { type: "string", default: "fake" },
    "record-fixtures": { type: "boolean", default: false },
    audio: { type: "boolean", default: false },
  },
});
const [file] = positionals;
const { resolution, provider } = values;
if (
  positionals.length !== 1 ||
  !file ||
  (resolution !== "precise" && resolution !== "vague") ||
  (provider !== "meta" && provider !== "fake")
) {
  console.error(usage);
  process.exit(2);
}
if (values["record-fixtures"] && provider !== "meta") {
  console.error("--record-fixtures records live responses: use it with --provider meta.");
  process.exit(2);
}

let scenario: Scenario;
let audioInput: Segment[] | undefined;
if (values.audio) {
  const audio = await loadAudioInput(resolve(file), loadScenarios());
  scenario = audio.scenario;
  const mapped = audioSegments(audio.scenario, audio.truth, audio.response);
  audioInput = mapped.segments;
  console.log(
    `${audio.name}: ${audioInput.length} segments, speakers ` +
      Object.entries(mapped.mapping)
        .map(([label, p]) => `${label}→${p ?? "none"}`)
        .join(", "),
  );
} else {
  scenario = parseScenario(readFileSync(resolve(file), "utf8"));
}
let model: ModelPort = provider === "fake" ? new FakeProvider() : liveMeta();
if (values["record-fixtures"]) model = new RecordingProvider(model);

const { record, segments, trace } = await runLoop(scenario, model, {
  resolution: resolution as ResolutionVariant,
  ...(audioInput ? { segments: audioInput } : {}),
});

const workspace = resolve(import.meta.dirname, "../../..");
const out = join(
  workspace,
  "var",
  "loop",
  `${scenario.id}-${resolution}${trace.source === "audio" ? "-audio" : ""}`,
);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`);
writeFileSync(join(out, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(join(out, "record.md"), renderRecordMarkdown(record, segments));

const count = (c: string) => record.items.filter((i) => i.category === c).length;
const calls = trace.stages.reduce((n, s) => n + s.calls.length, 0);
console.log(
  `${scenario.id} (${resolution}, ${provider}, source: ${trace.source}): ${trace.selected.length} probes asked, ` +
    `${trace.splits.length} splits; record stated ${count("stated")}, ` +
    `confirmed ${count("confirmed")}, unresolved ${count("unresolved")}; ` +
    `${calls} model calls, $${trace.costUsd.toFixed(4)}`,
);
for (const f of trace.validation.findings)
  console.log(`  INVALID ${f.rule} ${f.itemId}: ${f.detail}`);
console.log(
  `Validator: ${trace.validation.ok ? "pass" : "FAIL"}. Wrote ${relative(process.cwd(), out)}/`,
);
process.exit(trace.validation.ok ? 0 : 1);
