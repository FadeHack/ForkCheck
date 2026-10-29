import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "@forkcheck/ai";
import { validateRecord } from "@forkcheck/core";
import { parseScenario, renderRecordMarkdown, runLoop } from "../src/index";

const demo = parseScenario(
  readFileSync(new URL("../../../scenarios/demo/sso-pilot.json", import.meta.url), "utf8"),
);
const scripted = (mismatch: string) =>
  demo.scriptedResolutions.find((r) => r.mismatch === mismatch)!;

// Replays the recorded live run: `pnpm loop scenarios/demo/sso-pilot.json --provider meta
// --record-fixtures` (with LIVE=1) re-records it after a prompt or stage change.
describe("headless loop on the demo scenario (fixtures)", () => {
  it("precise: the record has all three categories and passes the validator", async () => {
    const { record, recordInput, segments, trace } = await runLoop(demo, new FakeProvider(), {
      resolution: "precise",
    });
    expect(trace.validation).toEqual({ ok: true, findings: [] });
    expect(validateRecord(record, recordInput).ok).toBe(true);

    const confirmed = record.items.filter((i) => i.category === "confirmed");
    const unresolved = record.items.filter((i) => i.category === "unresolved");
    expect(record.items.some((i) => i.category === "stated")).toBe(true);
    expect(confirmed.map((i) => [i.text, i.recheck])).toEqual([
      [scripted("friday-meaning").precise.text, "passed"],
    ]);
    expect(unresolved.map((i) => i.text)).toEqual([
      expect.stringMatching(/^Left open by agreement \(scope\): /),
    ]);
    expect(trace.splits.map((s) => [s.mismatch, s.state.status])).toEqual([
      ["friday-meaning", "rechecked"],
      ["provisioning-scope", "unresolved"],
    ]);
    expect(trace.costUsd).toBe(0);

    await expect(`${JSON.stringify(record, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/demo-sso-pilot-precise.record.json",
    );
    // The app's record endpoint test seeds its database from this and expects the same record.
    await expect(`${JSON.stringify(recordInput, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/demo-sso-pilot-precise.record-input.json",
    );
    await expect(renderRecordMarkdown(record, segments)).toMatchFileSnapshot(
      "./__snapshots__/demo-sso-pilot-precise.record.md",
    );
  });

  it("vague: the recheck splits, the split reopens and the record still validates", async () => {
    const { record, recordInput, trace } = await runLoop(demo, new FakeProvider(), {
      resolution: "vague",
    });
    expect(scripted("friday-meaning").vague.expectedRecheck).toBe("split");
    expect(trace.validation.ok).toBe(true);
    expect(record.items.filter((i) => i.category === "confirmed")).toEqual([]);
    expect(trace.splits.map((s) => [s.mismatch, s.state.status])).toEqual([
      ["friday-meaning", "reopened"],
      ["provisioning-scope", "unresolved"],
    ]);
    await expect(`${JSON.stringify(record, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/demo-sso-pilot-vague.record.json",
    );
    await expect(`${JSON.stringify(recordInput, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/demo-sso-pilot-vague.record-input.json",
    );
  });
});
