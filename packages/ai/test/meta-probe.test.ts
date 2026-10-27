import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkModelList,
  checkOutput,
  estimateCostUsd,
  probeJsonSchema,
} from "../scripts/meta-probe-checks";

describe("checkModelList", () => {
  it("passes when both Meta models are listed", () => {
    expect(checkModelList(["muse-spark-1.3", "muse-voice-transcribe-1.0", "other"]).ok).toBe(true);
  });

  it("names the missing model", () => {
    const check = checkModelList(["muse-spark-1.3"]);
    expect(check.ok).toBe(false);
    expect(check.detail).toBe("missing muse-voice-transcribe-1.0");
  });
});

describe("checkOutput", () => {
  const valid = JSON.stringify({
    decision: "Ship the pricing page",
    owner: "Marco",
    due_kind: "relative",
  });

  it("passes valid output", () => {
    expect(checkOutput(valid, "stop").every((c) => c.ok)).toBe(true);
  });

  it("fails non-JSON content", () => {
    expect(checkOutput("not json", "stop").find((c) => c.name === "JSON parse")?.ok).toBe(false);
  });

  it("fails output that breaks the schema", () => {
    const extra = JSON.stringify({ decision: "x", owner: null, due_kind: "soon", extra: 1 });
    expect(checkOutput(extra, "stop").find((c) => c.name.startsWith("Zod"))?.ok).toBe(false);
  });

  it("fails a truncated response", () => {
    expect(checkOutput(valid, "length").find((c) => c.name === "finish reason")?.ok).toBe(false);
  });
});

describe("probeJsonSchema", () => {
  it("meets strict mode: no $schema key, all keys required, no extra properties", () => {
    expect(probeJsonSchema).not.toHaveProperty("$schema");
    expect(probeJsonSchema).toMatchObject({
      additionalProperties: false,
      required: ["decision", "owner", "due_kind"],
    });
  });
});

describe("estimateCostUsd", () => {
  it("prices cached input separately", () => {
    expect(
      estimateCostUsd({
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        cached_tokens: 200_000,
      }),
    ).toBeCloseTo(0.8 * 1.25 + 0.2 * 0.15 + 4.25);
  });
});

describe("probe-meta script", () => {
  it("refuses to run without LIVE=1", () => {
    const cwd = mkdtempSync(join(tmpdir(), "forkcheck-probe-"));
    try {
      const script = fileURLToPath(new URL("../scripts/probe-meta.ts", import.meta.url));
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
