import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASETEN_MODEL } from "../src/index";
import {
  checkHttp,
  checkModelList,
  checkOutput,
  estimateCostUsd,
  probeJsonSchema,
} from "../scripts/baseten-probe-checks";

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

describe("BASETEN_MODEL", () => {
  it("is the exact model ID", () => {
    expect(BASETEN_MODEL).toBe("meta-models/muse-spark-open-1026");
  });
});

describe("checkModelList", () => {
  it("passes when the exact ID is listed", () => {
    expect(checkModelList([BASETEN_MODEL, "other"]).ok).toBe(true);
  });

  it("fails on a generic slug without the exact ID", () => {
    const check = checkModelList(["meta-models/muse-spark-open"]);
    expect(check.ok).toBe(false);
    expect(check.detail).toBe(`missing ${BASETEN_MODEL}`);
  });
});

describe("checkHttp", () => {
  it("fails non-2xx statuses", () => {
    expect(checkHttp(200).ok).toBe(true);
    expect(checkHttp(403).ok).toBe(false);
    expect(checkHttp(500).ok).toBe(false);
  });
});

describe("checkOutput", () => {
  const valid = JSON.stringify({
    decision: "Ship the pricing page",
    owner: "Marco",
    due_kind: "date",
  });

  it("passes valid output", () => {
    expect(checkOutput(valid, "stop").every((c) => c.ok)).toBe(true);
  });

  it("fails non-JSON content", () => {
    expect(checkOutput("```json\n{}\n```", "stop").find((c) => c.name === "JSON parse")?.ok).toBe(
      false,
    );
  });

  it("fails output that breaks the schema, naming the field", () => {
    const check = checkOutput(JSON.stringify({ decision: "x", due_kind: "soon" }), "stop").find(
      (c) => c.name.startsWith("Zod"),
    );
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("owner");
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

describe("probe-baseten script", () => {
  const run = (env: Record<string, string>) => {
    const cwd = mkdtempSync(join(tmpdir(), "forkcheck-baseten-probe-"));
    try {
      const script = fileURLToPath(new URL("../scripts/probe-baseten.ts", import.meta.url));
      return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script], {
        cwd,
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };

  it("refuses to run without LIVE=1", () => {
    const result = run({ LIVE: "0", BASETEN_API_KEY: "test-baseten-key" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("set LIVE=1");
  });

  it("requires BASETEN_API_KEY", () => {
    const result = run({ LIVE: "0" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BASETEN_API_KEY");
  });
});
