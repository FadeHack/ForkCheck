/**
 * Live probe of Voice Transcribe: renders a two-voice script with macOS `say`, converts it
 * to 24 kHz mono 16-bit WAV with ffmpeg, and transcribes it in DIARIZATION mode.
 * Usage: LIVE=1 tsx packages/asr/scripts/probe-transcribe.ts [--out <markdown file to append to>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import {
  TRANSCRIBE_MODEL,
  TRANSCRIBE_URL,
  transcribeCostUsd,
  type TranscribeRequest,
} from "../src/transcribe";
import { checkResponse, probeScript, type Check } from "./transcribe-probe-checks";

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

const outIndex = process.argv.indexOf("--out");
const outFile = outIndex === -1 ? undefined : process.argv[outIndex + 1];

const SAMPLE_RATE = 24_000;
const toWav = ["-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-map_metadata", "-1"];
const work = mkdtempSync(join(tmpdir(), "forkcheck-asr-probe-"));

let wavBytes: Buffer;
let fileDurationMs: number;
try {
  const parts: string[] = [];
  const gap = join(work, "gap.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
    "-t",
    "0.5",
    ...toWav,
    gap,
  ]);
  probeScript.forEach((line, i) => {
    const aiff = join(work, `${i}.aiff`);
    const wav = join(work, `${i}.wav`);
    execFileSync("say", ["-v", line.voice, "-o", aiff, line.text]);
    execFileSync("ffmpeg", ["-v", "error", "-i", aiff, ...toWav, wav]);
    parts.push(wav, gap);
  });
  const list = join(work, "list.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const out = join(work, "probe.wav");
  execFileSync("ffmpeg", ["-v", "error", "-f", "concat", "-safe", "0", "-i", list, ...toWav, out]);
  wavBytes = readFileSync(out);
  const seconds = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
    { encoding: "utf8" },
  );
  fileDurationMs = Math.round(Number(seconds) * 1000);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const request: TranscribeRequest = {
  model: TRANSCRIBE_MODEL,
  audioEncoding: "WAV",
  mode: "DIARIZATION",
  keywords: [...new Set(probeScript.map((l) => l.speaker))],
  languageBias: ["English"],
};
const form = new FormData();
form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
form.append("audio", new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" }), "probe.wav");

const start = performance.now();
const res = await fetch(TRANSCRIBE_URL, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, Accept: "application/json" },
  body: form,
});
const latencyMs = Math.round(performance.now() - start);
const text = await res.text();

const lines: string[] = [`## Voice Transcribe probe, ${new Date().toISOString()}`, ""];
lines.push(
  `- Audio: ${probeScript.length} lines, voices ${[...new Set(probeScript.map((l) => l.voice))].join(" / ")}, ${wavBytes.length} bytes, ${fileDurationMs} ms`,
);
lines.push(
  `- \`POST /asr/transcribe\` (DIARIZATION, keywords ${request.keywords?.join(", ")}): HTTP ${res.status}, ${latencyMs} ms`,
);

const checks: Check[] = [{ name: "HTTP 200", ok: res.ok, detail: String(res.status) }];
let body: unknown;
try {
  body = JSON.parse(text);
} catch {
  checks.push({ name: "JSON body", ok: false, detail: text.slice(0, 200) });
}

if (body !== undefined) {
  const report = checkResponse(body, fileDurationMs);
  checks.push(...report.checks);
  if (report.response) {
    const r = report.response;
    lines.push(
      `- sessionId: \`${r.sessionId}\`, audioDurationMs: ${r.audioDurationMs}, est. $${transcribeCostUsd(r.audioDurationMs).toFixed(5)}`,
    );
    lines.push(
      `- Extra keys beyond R§4.1: ${report.extraKeys.length ? report.extraKeys.join(", ") : "none"}`,
    );
    lines.push(`- turnId type: ${typeof r.turns[0]?.turnId}`);
    lines.push(
      "",
      "| Expected | Turn | Speaker | Start–end ms | Transcript |",
      "|---|---|---|---|---|",
    );
    r.turns.forEach((t, i) => {
      const expected = probeScript[i]?.speaker ?? "";
      lines.push(
        `| ${expected} | ${t.turnId} | ${t.speaker ?? "—"} | ${t.startMs}–${t.endMs} | ${t.transcript} |`,
      );
    });
  } else {
    lines.push(`- Raw body (first 500 chars): \`${text.slice(0, 500)}\``);
  }
} else if (!res.ok) {
  lines.push(`- Error body: \`${text.slice(0, 500)}\``);
}

lines.push("", "| Check | Result | Detail |", "|---|---|---|");
for (const c of checks) lines.push(`| ${c.name} | ${c.ok ? "pass" : "FAIL"} | ${c.detail} |`);

const report = lines.join("\n") + "\n";
console.log(report);
if (outFile) appendFileSync(outFile, "\n" + report);

if (checks.some((c) => !c.ok)) process.exitCode = 1;
