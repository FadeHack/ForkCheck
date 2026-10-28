/**
 * Renders scenario transcripts to speech with macOS `say`, one voice per participant.
 * Usage: pnpm audio:render <scenario.json>... [--variant clean|overlap|backchannel]... [--out <dir>]
 * Writes <out>/<scenario>.<variant>.wav and .truth.json (default out: var/audio/synthetic).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectWav } from "@forkcheck/asr";
import { findWorkspaceRoot, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { parseTranscript } from "@forkcheck/core";
import {
  assignVoices,
  BACKCHANNEL_TEXT,
  encodeWav,
  mixPcm,
  parseScenario,
  planTimeline,
  RENDER_SAMPLE_RATE,
  renderVariant,
  type ClipTurn,
} from "../src/index";

const usage =
  "Usage: pnpm audio:render <scenario.json>... [--variant clean|overlap|backchannel]... [--out <dir>]";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    variant: { type: "string", multiple: true, default: ["clean"] },
    out: { type: "string" },
  },
});
const variants = values.variant.map((v) => renderVariant.safeParse(v));
if (positionals.length === 0 || variants.some((v) => !v.success)) {
  console.error(usage);
  process.exit(2);
}

loadLocalEnvFile();
const ffmpeg = loadEnv().FFMPEG_PATH;
const root = findWorkspaceRoot() ?? process.cwd();
const outDir = resolve(values.out ?? join(root, "var", "audio", "synthetic"));
mkdirSync(outDir, { recursive: true });

const work = mkdtempSync(join(tmpdir(), "forkcheck-render-"));
const clips = new Map<string, Int16Array>();

/** Speaks one line and returns 24 kHz mono 16-bit samples. Cached per voice and text. */
function speak(voice: string, text: string): Int16Array {
  const key = `${voice}\u0000${text}`;
  const cached = clips.get(key);
  if (cached) return cached;
  const aiff = join(work, "line.aiff");
  const raw = join(work, "line.pcm");
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-i",
    aiff,
    "-ac",
    "1",
    "-ar",
    String(RENDER_SAMPLE_RATE),
    "-f",
    "s16le",
    "-c:a",
    "pcm_s16le",
    raw,
  ]);
  const bytes = readFileSync(raw);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2).slice();
  clips.set(key, samples);
  return samples;
}

const durationMs = (samples: Int16Array) =>
  Math.round((samples.length * 1000) / RENDER_SAMPLE_RATE);

let failed = false;
try {
  for (const file of positionals) {
    const s = parseScenario(readFileSync(file, "utf8"));
    const voices = assignVoices(s.participants);
    const { segments } = parseTranscript({
      meetingId: s.id,
      text: s.transcript,
      participants: s.participants.map((p) => ({ id: p, displayName: p })),
    });
    const lines = segments.map((seg) => {
      if (!seg.participantId) throw new Error(`${s.id}: turn ${seg.idx} has no known speaker`);
      const samples = speak(voices[seg.participantId]!, seg.text);
      return { speaker: seg.participantId, text: seg.text, samples };
    });
    const turns: ClipTurn[] = lines.map((l) => ({
      speaker: l.speaker,
      text: l.text,
      durationMs: durationMs(l.samples),
    }));
    const backchannel = Object.fromEntries(
      s.participants.map((p) => [p, speak(voices[p]!, BACKCHANNEL_TEXT)]),
    );

    for (const parsed of variants) {
      const variant = parsed.data!;
      const truth = planTimeline({
        scenarioId: s.id,
        variant,
        participants: s.participants,
        turns,
        backchannelMs: Object.fromEntries(
          Object.entries(backchannel).map(([p, samples]) => [p, durationMs(samples)]),
        ),
      });
      const wav = encodeWav(
        mixPcm(
          truth.turns.map((t) => ({
            startMs: t.startMs,
            samples: t.kind === "turn" ? lines[t.scriptIdx!]!.samples : backchannel[t.speaker]!,
          })),
          truth.durationMs,
        ),
      );
      const base = join(outDir, `${s.id}.${variant}`);
      writeFileSync(`${base}.wav`, wav);
      writeFileSync(`${base}.truth.json`, JSON.stringify(truth, null, 2) + "\n");

      const report = inspectWav(wav);
      const gap = Math.abs((report.info?.durationMs ?? 0) - truth.durationMs);
      const ok = report.ok && gap <= 50;
      failed ||= !ok;
      console.log(
        `${ok ? "pass" : "FAIL"}  ${relative(process.cwd(), base)}.wav  ` +
          `${((report.info?.durationMs ?? 0) / 1000).toFixed(1)} s, ${truth.turns.length} lines` +
          (report.ok ? "" : `  ${report.problems.map((p) => p.message).join(" ")}`),
      );
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
