import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONVERT_ARGS } from "../src/convert";
import { inspectWav } from "../src/wav";
import { probeScript } from "./transcribe-probe-checks";

/** Renders the probe script with macOS `say`, 0.5 s of silence after each line. */
export function renderProbeWav(): { wavBytes: Buffer; fileDurationMs: number } {
  const work = mkdtempSync(join(tmpdir(), "forkcheck-asr-probe-"));
  try {
    const parts: string[] = [];
    const gap = join(work, "gap.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=24000:cl=mono",
      "-t",
      "0.5",
      ...CONVERT_ARGS,
      gap,
    ]);
    probeScript.forEach((line, i) => {
      const aiff = join(work, `${i}.aiff`);
      const wav = join(work, `${i}.wav`);
      execFileSync("say", ["-v", line.voice, "-o", aiff, line.text]);
      execFileSync("ffmpeg", ["-v", "error", "-i", aiff, ...CONVERT_ARGS, wav]);
      parts.push(wav, gap);
    });
    const list = join(work, "list.txt");
    writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
    const out = join(work, "probe.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      ...CONVERT_ARGS,
      out,
    ]);
    const wavBytes = readFileSync(out);
    return { wavBytes, fileDurationMs: inspectWav(wavBytes).info?.durationMs ?? 0 };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
