import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FakeProvider,
  FallbackProvider,
  ModelCallError,
  RecordingProvider,
  ScriptedProvider,
  type ModelCallErrorKind,
  type ModelPort,
  type ModelRequest,
} from "../src/index";

const schema = z.object({ answer: z.string() });
const request: ModelRequest<z.infer<typeof schema>> = {
  stage: "extract",
  promptVersion: "extract-v1",
  messages: [{ role: "user", content: "Who ships the pricing page?" }],
  schema,
  reasoningEffort: "low",
};

const failing = (kind: ModelCallErrorKind): ModelPort => ({
  call: () => Promise.reject(new ModelCallError(kind, `${kind} failure`, 3)),
});

let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "forkcheck-fallback-"));
  await new RecordingProvider(new ScriptedProvider({ extract: [{ answer: "Priya" }] }), dir).call(
    request,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FallbackProvider", () => {
  it.each(["network", "timeout", "server", "rate_limited"] as const)(
    "replays the recorded reply when the live call fails with %s",
    async (kind) => {
      const response = await new FallbackProvider(failing(kind), new FakeProvider(dir)).call(
        request,
      );
      expect(response.output).toEqual({ answer: "Priya" });
      expect(response.call.provider).toBe("fake");
    },
  );

  it("passes a bad request through: a replay would hide a bug", async () => {
    const provider = new FallbackProvider(failing("request"), new FakeProvider(dir));
    await expect(provider.call(request)).rejects.toMatchObject({ kind: "request" });
  });

  it("reports the live error when there is no recording to fall back to", async () => {
    const empty = mkdtempSync(join(tmpdir(), "forkcheck-fallback-empty-"));
    try {
      const provider = new FallbackProvider(failing("network"), new FakeProvider(empty));
      await expect(provider.call(request)).rejects.toMatchObject({ kind: "network" });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("uses the live reply when the call succeeds", async () => {
    const live = new ScriptedProvider({ extract: [{ answer: "Marco" }] });
    const response = await new FallbackProvider(live, new FakeProvider(dir)).call(request);
    expect(response.output).toEqual({ answer: "Marco" });
  });
});
