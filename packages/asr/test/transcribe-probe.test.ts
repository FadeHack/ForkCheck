import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transcribeCostUsd } from "../src/index";
import { checkResponse, probeScript, wordRecall } from "../scripts/transcribe-probe-checks";

const scriptText = probeScript.map((l) => l.text).join(" ");

const goodResponse = () => ({
  sessionId: "s-1",
  transcript: scriptText,
  audioDurationMs: 30_000,
  turns: probeScript.map((line, i) => ({
    turnId: i,
    startMs: i * 5000,
    endMs: i * 5000 + 4000,
    transcript: line.text,
    speaker: line.speaker === "Priya" ? "A" : "B",
  })),
});

const check = (body: unknown, name: string) =>
  checkResponse(body, 30_000).checks.find((c) => c.name.startsWith(name));

describe("wordRecall", () => {
  it("is 1 for an exact match, ignoring case and punctuation", () => {
    expect(wordRecall("Ship it on Friday.", "ship IT on friday")).toBe(1);
  });

  it("counts repeated words only as often as they appear", () => {
    expect(wordRecall("no no no yes", "no yes")).toBe(0.5);
  });
});

describe("checkResponse", () => {
  it("passes a documented response", () => {
    const report = checkResponse(goodResponse(), 30_000);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.extraKeys).toEqual([]);
  });

  it("fails loudly on a missing field, naming it", () => {
    const { sessionId: _dropped, ...body } = goodResponse();
    const schema = check(body, "response schema");
    expect(schema?.ok).toBe(false);
    expect(schema?.detail).toContain("sessionId");
  });

  it("fails on a wrong field type", () => {
    expect(check({ ...goodResponse(), audioDurationMs: "30000" }, "response schema")?.ok).toBe(
      false,
    );
  });

  it("fails with a single speaker label", () => {
    const body = goodResponse();
    for (const t of body.turns) t.speaker = "A";
    expect(check(body, "distinct speaker")?.ok).toBe(false);
  });

  it("fails when the transcript is mostly wrong", () => {
    expect(check({ ...goodResponse(), transcript: "hello world" }, "word recall")?.ok).toBe(false);
  });

  it("fails when the reported duration is off by more than a second", () => {
    expect(check({ ...goodResponse(), audioDurationMs: 32_000 }, "audioDurationMs")?.ok).toBe(
      false,
    );
  });

  it("reports undocumented keys", () => {
    const body = goodResponse();
    const withExtras = { ...body, language: "en", turns: body.turns.map((t) => ({ ...t, x: 1 })) };
    expect(checkResponse(withExtras, 30_000).extraKeys).toEqual(["language", "turns[].x"]);
  });
});

describe("transcribeCostUsd", () => {
  it("bills whole seconds at $0.18 per hour", () => {
    expect(transcribeCostUsd(30_999)).toBeCloseTo((30 * 0.18) / 3600);
  });
});

describe("probe-transcribe script", () => {
  it("refuses to run without LIVE=1", () => {
    const cwd = mkdtempSync(join(tmpdir(), "forkcheck-asr-probe-"));
    try {
      const script = fileURLToPath(new URL("../scripts/probe-transcribe.ts", import.meta.url));
      const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script], {
        cwd,
        env: { PATH: process.env.PATH, LIVE: "0", MODEL_API_KEY: "test-model-key" },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("set LIVE=1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
