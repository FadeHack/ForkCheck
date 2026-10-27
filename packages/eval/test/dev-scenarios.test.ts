import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveDatePhrase } from "@forkcheck/core";
import { lintScenario, parseScenario, type Scenario } from "../src/index";

const dir = new URL("../../../scenarios/dev/", import.meta.url);
const dev: Scenario[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => parseScenario(readFileSync(new URL(f, dir), "utf8")));
const byId = new Map(dev.map((s) => [s.id, s]));

describe("dev scenario set", () => {
  it("has the R§6.5 composition: 6 planted mismatches and 2 controls", () => {
    expect(dev).toHaveLength(8);
    expect(dev.every((s) => s.set === "dev")).toBe(true);
    const counts: Record<string, number> = {};
    for (const s of dev) counts[s.category] = (counts[s.category] ?? 0) + 1;
    expect(counts).toEqual({
      deadline: 2,
      ownership: 1,
      scope: 1,
      criteria: 1,
      partial_agreement: 1,
      same_reading: 1,
      aligned: 1,
    });
  });

  it.each(dev.map((s) => [s.id, s] as const))("%s passes the lint", (_id, s) => {
    expect(lintScenario(s)).toEqual([]);
  });

  it.each(dev.map((s) => [s.id, s] as const))(
    "%s: briefs disagree only where a mismatch is planted",
    (_id, s) => {
      const planted = new Set(s.plantedMismatches.map((m) => `${m.decision}/${m.dimension}`));
      const readings = new Map<string, Set<string>>();
      for (const b of s.briefs) {
        for (const r of b.readings) {
          const key = `${r.decision}/${r.dimension}`;
          readings.set(key, (readings.get(key) ?? new Set()).add(r.reading));
        }
      }
      const disagreeing = [...readings].filter(([, set]) => set.size > 1).map(([key]) => key);
      expect(new Set(disagreeing)).toEqual(planted);
    },
  );

  it("controls have no mismatches; the rest have exactly one with a precise and a vague fix", () => {
    for (const s of dev) {
      const control = s.category === "same_reading" || s.category === "aligned";
      expect(s.plantedMismatches, s.id).toHaveLength(control ? 0 : 1);
      for (const r of s.scriptedResolutions) {
        expect(r.precise.expectedRecheck, s.id).toBe("consistent");
        expect(r.vague.expectedRecheck, s.id).toBe("split");
      }
    }
  });

  it("every participant has a brief", () => {
    for (const s of dev) {
      expect(s.briefs.map((b) => b.participant).sort(), s.id).toEqual([...s.participants].sort());
    }
  });
});

describe("lintScenario", () => {
  it("flags a brief reading stated in the transcript", () => {
    const s = structuredClone(byId.get("dev-deadline-next-friday")!);
    s.briefs[0]!.readings[0]!.reading = "Next Friday is   FINE";
    expect(lintScenario(s)).toMatchObject([
      { rule: "brief_in_transcript", path: ["briefs", 0, "readings", 0] },
    ]);
  });
});

/**
 * M1.3's deferred acceptance: every deadline phrase in the dev transcripts, with the
 * dates worked out by hand from each meeting's local day.
 */
describe("dev scenario date phrases", () => {
  const table: [scenario: string, phrase: string, dates: string[]][] = [
    // Wednesday 2026-10-21, London.
    ["dev-deadline-end-of-month", "end of month", ["2026-10-31", "2026-10-30"]],
    ["dev-deadline-end-of-month", "today", ["2026-10-21"]],
    ["dev-deadline-end-of-month", "this week", ["2026-10-23", "2026-10-25"]],
    ["dev-deadline-end-of-month", "this afternoon", []],
    // Wednesday 2026-10-28, Chicago (still CDT).
    ["dev-deadline-next-friday", "next Friday", ["2026-10-30", "2026-11-06"]],
    // Tuesday 2026-11-03, Los Angeles (PST since Nov 1).
    ["dev-ownership-outage-email", "tomorrow", ["2026-11-04"]],
    ["dev-ownership-outage-email", "by Thursday", ["2026-11-05"]],
    // Monday 2026-11-02, Kolkata.
    ["dev-scope-dashboard-demo", "Thursday", ["2026-11-05"]],
    ["dev-scope-dashboard-demo", "on Wednesday", ["2026-11-04"]],
    ["dev-scope-dashboard-demo", "next week", ["2026-11-13", "2026-11-15"]],
    // Monday 2026-10-26, Berlin (CET since Oct 25).
    ["dev-criteria-usual-qa", "today", ["2026-10-26"]],
    ["dev-criteria-usual-qa", "Wednesday", ["2026-10-28"]],
    // Thursday 2026-11-05, New York.
    ["dev-partial-pricing-page", "the 13th", ["2026-11-13"]],
    ["dev-partial-pricing-page", "on Monday", ["2026-11-09"]],
    // Tuesday 2026-10-27, Sydney (AEDT).
    ["dev-same-reading-loop-in-legal", "before Friday", ["2026-10-30"]],
    ["dev-same-reading-loop-in-legal", "today", ["2026-10-27"]],
    ["dev-same-reading-loop-in-legal", "the 6th", ["2026-11-06"]],
    // Friday 2026-10-30, UTC.
    ["dev-aligned-key-rotation", "Tuesday November 3rd", ["2026-11-03"]],
    ["dev-aligned-key-rotation", "Tuesday the 3rd", ["2026-11-03"]],
    ["dev-aligned-key-rotation", "Wednesday morning", ["2026-11-04"]],
  ];

  it.each(table)("%s: %s", (id, phrase, expected) => {
    const s = byId.get(id)!;
    expect(s.transcript.toLowerCase()).toContain(phrase.toLowerCase());
    expect(resolveDatePhrase(phrase, s.heldAt, s.timezone).map((r) => r.date)).toEqual(expected);
  });
});
