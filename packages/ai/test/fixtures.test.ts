import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalJson,
  extractOutput,
  FakeProvider,
  fixtureKey,
  fixturePath,
  fixtureProvider,
  MissingFixtureError,
  RecordingProvider,
  type ModelPort,
  type ModelRequest,
  type ModelResponse,
} from "../src/index";

type ExtractOutput = z.infer<typeof extractOutput>;

const request = (
  content = "Priya: Ship the pricing page by Friday.",
): ModelRequest<ExtractOutput> => ({
  stage: "extract",
  promptVersion: "extract-v1",
  messages: [
    { role: "developer", content: "Extract decisions." },
    { role: "user", content },
  ],
  schema: extractOutput,
  reasoningEffort: "low",
});

const output: ExtractOutput = {
  decisions: [
    {
      kind: "decision",
      statement: "Ship the pricing page by Friday",
      ownerText: "Priya",
      deadlineText: "by Friday",
      status: "explicit",
      evidence: [{ segmentId: "s1", quote: "Ship the pricing page by Friday." }],
    },
  ],
};

class StubLive implements ModelPort {
  calls = 0;
  async call<T>(req: ModelRequest<T>): Promise<ModelResponse<T>> {
    this.calls++;
    return {
      output: req.schema.parse(output),
      call: {
        stage: req.stage,
        provider: "meta",
        model: "muse-spark-1.3",
        promptVersion: req.promptVersion,
        cacheHit: false,
        latencyMs: 1200,
        inputTokens: 120,
        outputTokens: 300,
        reasoningTokens: 250,
        costUsd: 0.0014,
        ok: true,
        error: null,
      },
    };
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "forkcheck-fixtures-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("fixtureKey", () => {
  it("hashes the same input the same way regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { x: 0, y: 1 }] }, b: 1 }),
    );
    const reordered = {
      ...request(),
      messages: request().messages.map((m) => ({ content: m.content, role: m.role })),
    };
    expect(fixtureKey(reordered)).toEqual(fixtureKey(request()));
  });

  it("changes with the input and lays files out by stage and prompt version", () => {
    const key = fixtureKey(request());
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fixtureKey(request("Marco: Let's wait.")).hash).not.toBe(key.hash);
    expect(fixturePath(dir, key)).toBe(join(dir, "extract", "extract-v1", `${key.hash}.json`));
  });

  it("rejects a prompt version that would escape the fixture folder", () => {
    expect(() => fixtureKey({ ...request(), promptVersion: "../x" })).toThrow("fixture path");
  });
});

describe("FakeProvider", () => {
  it("throws on a miss, naming the stage, prompt version, hash and path", async () => {
    const key = fixtureKey(request());
    const error = await new FakeProvider(dir).call(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingFixtureError);
    const message = (error as Error).message;
    for (const part of ["extract", "extract-v1", key.hash, fixturePath(dir, key)]) {
      expect(message).toContain(part);
    }
  });

  it("returns a recorded fixture on a hit, at no cost", async () => {
    await new RecordingProvider(new StubLive(), dir).call(request());
    const replay = await new FakeProvider(dir).call(request());
    expect(replay.output).toEqual(output);
    expect(replay.call).toMatchObject({ provider: "fake", model: "muse-spark-1.3", costUsd: 0 });
  });

  it("refuses a fixture that no longer matches the schema", async () => {
    await new RecordingProvider(new StubLive(), dir).call(request());
    const strictBool = { ...request(), schema: z.strictObject({ ok: z.boolean() }) };
    await expect(new FakeProvider(dir).call(strictBool)).rejects.toThrow("re-record");
  });
});

describe("RecordingProvider", () => {
  it("writes a fixture that a later replay reads back identically", async () => {
    const live = new StubLive();
    const recorded = await new RecordingProvider(live, dir).call(request());
    expect(live.calls).toBe(1);

    const file = JSON.parse(readFileSync(fixturePath(dir, fixtureKey(request())), "utf8"));
    expect(file.request.messages).toEqual(request().messages);
    expect(file.recorded).toEqual({
      provider: "meta",
      model: "muse-spark-1.3",
      inputTokens: 120,
      outputTokens: 300,
      reasoningTokens: 250,
    });

    const replay = await new FakeProvider(dir).call(request());
    expect(replay.output).toEqual(recorded.output);
  });
});

describe("fixtureProvider", () => {
  it("replays by default and records only when asked", async () => {
    expect(fixtureProvider({ RECORD_FIXTURES: false }, new StubLive(), dir)).toBeInstanceOf(
      FakeProvider,
    );
    expect(fixtureProvider({ RECORD_FIXTURES: true }, new StubLive(), dir)).toBeInstanceOf(
      RecordingProvider,
    );
    expect(() => fixtureProvider({ RECORD_FIXTURES: true }, null, dir)).toThrow("live provider");
  });
});
