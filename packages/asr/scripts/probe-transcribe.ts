/**
 * Live probe of Voice Transcribe: renders a two-voice script with macOS `say`, converts it
 * to 24 kHz mono 16-bit WAV with ffmpeg, and transcribes it in DIARIZATION mode.
 * Usage: LIVE=1 tsx packages/asr/scripts/probe-transcribe.ts [--out <markdown file to append to>]
 */
import { appendFileSync } from "node:fs";
import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import {
  TRANSCRIBE_MODEL,
  TRANSCRIBE_URL,
  transcribeCostUsd,
  type TranscribeRequest,
} from "../src/transcribe";
import { renderProbeWav } from "./probe-audio";
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

const { wavBytes, fileDurationMs } = renderProbeWav();

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
