import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LoggedProvider, MemoryCallLog, ScriptedProvider } from "../src/index";

describe("LoggedProvider", () => {
  it("logs each call the inner port makes, with no message content", async () => {
    const log = new MemoryCallLog();
    const port = new LoggedProvider(
      new ScriptedProvider({ extract: [{ n: 1 }] }),
      log,
      () => new Date("2026-10-29T14:00:00.000Z"),
    );
    const res = await port.call({
      stage: "extract",
      promptVersion: "extract.v1",
      messages: [{ role: "user", content: "Priya: ship it Friday." }],
      schema: z.object({ n: z.number() }),
      reasoningEffort: "low",
    });
    expect(res.output).toEqual({ n: 1 });
    expect(log.entries).toEqual([{ ...res.call, at: "2026-10-29T14:00:00.000Z" }]);
    expect(JSON.stringify(log.entries)).not.toContain("Friday");
  });

  it("logs nothing when the inner call throws", async () => {
    const log = new MemoryCallLog();
    const port = new LoggedProvider(new ScriptedProvider({}), log);
    await expect(
      port.call({
        stage: "extract",
        promptVersion: "extract.v1",
        messages: [],
        schema: z.object({}),
        reasoningEffort: "low",
      }),
    ).rejects.toThrow();
    expect(log.entries).toEqual([]);
  });
});
