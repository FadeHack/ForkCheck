import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  checkStrictRules,
  responseFormatName,
  stageJsonSchema,
  stageNames,
  StrictSchemaError,
  toStrictJsonSchema,
  type JsonSchema,
} from "../src/index";

const problems = (schema: JsonSchema) => checkStrictRules(schema).map((i) => i.problem);

describe("stage schemas", () => {
  it.each(stageNames)("%s passes the strict-rules checker", (stage) => {
    const schema = stageJsonSchema(stage);
    expect(schema).not.toHaveProperty("$schema");
    expect(checkStrictRules(schema)).toEqual([]);
  });

  it("names response formats in snake case", () => {
    expect(responseFormatName("findCandidates")).toBe("find_candidates_output");
  });
});

describe("checkStrictRules", () => {
  it("rejects an optional key", () => {
    const schema = z.strictObject({ a: z.string(), b: z.string().optional() });
    expect(() => toStrictJsonSchema("t", schema)).toThrow(StrictSchemaError);
    expect(() => toStrictJsonSchema("t", schema)).toThrow("optional keys b");
  });

  it("accepts the same field as nullable", () => {
    const schema = z.strictObject({ a: z.string(), b: z.string().nullable() });
    expect(() => toStrictJsonSchema("t", schema)).not.toThrow();
  });

  it("rejects an object without additionalProperties: false", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    expect(problems(schema)).toEqual(["additionalProperties is not false"]);
  });

  it("checks objects nested in arrays and anyOf", () => {
    const loose = { type: "object", properties: {}, required: [] };
    const schema = {
      type: "object",
      properties: { a: { type: "array", items: loose }, b: { anyOf: [loose, { type: "null" }] } },
      required: ["a", "b"],
      additionalProperties: false,
    };
    expect(problems(schema)).toHaveLength(2);
  });

  it("allows depth 10 and rejects depth 11", () => {
    const nest = (levels: number): z.ZodType =>
      levels === 1 ? z.strictObject({ v: z.string() }) : z.strictObject({ n: nest(levels - 1) });
    expect(checkStrictRules(toJson(nest(10)))).toEqual([]);
    expect(problems(toJson(nest(11)))).toEqual(["nesting depth 11 exceeds 10"]);
  });

  it("rejects a recursive schema", () => {
    type Node = { next: Node | null };
    const node: z.ZodType<Node> = z.lazy(() => z.strictObject({ next: node.nullable() }));
    expect(problems(toJson(node))).toEqual(["recursive $ref #"]);
  });

  it("follows a non-recursive $ref", () => {
    const schema = {
      type: "object",
      properties: { a: { $ref: "#/$defs/leaf" } },
      required: ["a"],
      additionalProperties: false,
      $defs: { leaf: { type: "object", properties: { x: { type: "string" } }, required: [] } },
    };
    expect(problems(schema)).toEqual([
      "optional keys x (use nullable)",
      "additionalProperties is not false",
    ]);
  });
});

describe("probe-schemas script", () => {
  it("refuses to run without LIVE=1", () => {
    const cwd = mkdtempSync(join(tmpdir(), "forkcheck-schema-probe-"));
    try {
      const script = fileURLToPath(new URL("../scripts/probe-schemas.ts", import.meta.url));
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

function toJson(schema: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: "output" }) as JsonSchema;
  return json;
}
