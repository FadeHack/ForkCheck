import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSheets,
  EVIDENCE_SAMPLE,
  importSheets,
  parseCsv,
  parseScenario,
  SHEETS,
  summarizeRatings,
  toCsv,
  type RunLog,
  type Scenario,
  type SheetKind,
  type Sheets,
} from "../src/index";

const load = (path: string) =>
  parseScenario(readFileSync(new URL(`../../../scenarios/${path}`, import.meta.url), "utf8"));
const scenarios = new Map<string, Scenario>(
  [
    "dev/deadline-next-friday.json",
    "dev/ownership-outage-email.json",
    "dev/scope-dashboard-demo.json",
  ].map((p) => {
    const s = load(p);
    return [s.id, s];
  }),
);

function log(scenario: Scenario, over: Partial<RunLog> = {}): RunLog {
  const [a, b] = scenario.participants as [string, string];
  return {
    runId: "r-1",
    run: 0,
    scenario: scenario.id,
    provider: "meta",
    source: "paste",
    resolution: "precise",
    depth: "loop",
    segments: [],
    decisions: [0, 1].map((idx) => ({
      decision: {
        id: `d${idx}`,
        meetingId: scenario.id,
        idx,
        kind: "commitment" as const,
        statement: `Claim ${idx}, with a comma`,
        ownerText: null,
        deadlineText: null,
        ownerInferred: false,
        deadlineInferred: false,
        status: "ambiguous" as const,
      },
      evidence: [0, 1, 2].map((j) => ({
        id: `e${idx}${j}`,
        decisionId: `d${idx}`,
        resolutionId: null,
        segmentId: "s1",
        quote: `She said "fine" (${idx}.${j})`,
      })),
    })),
    candidates: [],
    rounds: [
      {
        probeId: "p1",
        stem: `Which day, for ${scenario.id}?`,
        options: [
          { id: "o1", text: "Friday the 7th" },
          { id: "o2", text: "Friday the 14th" },
        ],
        answers: [
          { participantId: a, choice: "option", optionId: "o2" },
          { participantId: b, choice: "unsure", optionId: null },
        ],
        divergence: { outcome: "split" },
      },
    ],
    splits: [],
    record: null,
    validation: null,
    stages: [],
    ...over,
  };
}

const logs = [...scenarios.values()].flatMap((s) => [
  log(s),
  log(s, { runId: "r-2", provider: "baseten", depth: "detect" }),
  log(s, { run: 1 }),
  log(s, { resolution: "vague" }),
]);

/** Fills every rating cell the way a careful rater would. */
function complete(sheets: Sheets): Record<SheetKind, string> {
  const fill = (sheet: SheetKind, values: Record<string, string>) => {
    const [header, ...rows] = parseCsv(sheets[sheet]);
    const columns = header!;
    return toCsv(
      columns,
      rows.map((row) => ({
        ...Object.fromEntries(columns.map((c, i) => [c, row[i]!])),
        ...values,
      })),
    );
  };
  return {
    questions: fill("questions", { clarity: "3", answerability: "2" }),
    evidence: fill("evidence", { supports: "yes" }),
    simulator: fill("simulator", { plausible: "no", notes: "ignores the brief, oddly" }),
  };
}

/** Rewrites a sheet's body rows; rows may come out short, to test the cell count check. */
function edit(csv: string, change: (rows: string[][]) => string[][]): string {
  const [header, ...rows] = parseCsv(csv);
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [header!, ...change(rows)].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
const set = (col: number, value: string) => (rows: string[][]) =>
  rows.map((r, i) => (i === 0 ? r.map((c, j) => (j === col ? value : c)) : r));

describe("CSV", () => {
  it("round-trips commas, quotes and line breaks", () => {
    const rows = [
      { a: 'say "hi", then', b: "line 1\nline 2" },
      { a: "", b: "plain" },
    ];
    const csv = toCsv(["a", "b"], rows);
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ['say "hi", then', "line 1\nline 2"],
      ["", "plain"],
    ]);
    expect(parseCsv(csv.replaceAll("\n", "\r\n"))[1]).toEqual([
      'say "hi", then',
      "line 1\r\nline 2",
    ]);
  });
});

describe("buildSheets", () => {
  const sheets = buildSheets(scenarios, logs, "seed-1");
  const rows = (k: SheetKind) => parseCsv(sheets[k]).slice(1);

  it("rates run 0 of the precise condition only, every provider", () => {
    expect(rows("questions")).toHaveLength(6);
    const providers = Object.values(sheets.key)
      .filter((k) => k.sheet === "questions")
      .map((k) => `${k.provider}/${k.condition}`);
    expect(new Set(providers)).toEqual(new Set(["meta/paste/precise", "baseten/paste/precise"]));
  });

  it("blinds the provider: opaque IDs in sorted order, no provider or run in any cell", () => {
    for (const kind of Object.keys(SHEETS) as SheetKind[]) {
      const [header, ...body] = parseCsv(sheets[kind]);
      expect(header).toEqual([...SHEETS[kind].columns]);
      const ids = body.map((r) => r[0]!);
      expect(ids).toEqual([...ids].sort());
      for (const id of ids) expect(id).toMatch(/^[qes]-[0-9a-f]{8}$/);
      expect(sheets[kind]).not.toMatch(/\b(baseten|meta|r-1|r-2)\b/i);
    }
  });

  it("keeps items from two providers apart when they share a run ID", () => {
    const shared = logs.map((l) => ({ ...l, runId: "same" }));
    const both = buildSheets(scenarios, shared, "seed-1");
    const ids = parseCsv(both.questions)
      .slice(1)
      .map((r) => r[0]);
    expect(new Set(ids).size).toBe(6);
  });

  it("samples a fixed share of the evidence, the same for the same seed", () => {
    // 3 scenarios × 2 providers × 2 decisions × 3 quotes = 36 quotes.
    expect(rows("evidence")).toHaveLength(Math.ceil(36 * EVIDENCE_SAMPLE));
    expect(buildSheets(scenarios, logs, "seed-1")).toEqual(sheets);
    expect(buildSheets(scenarios, logs, "seed-2").evidence).not.toEqual(sheets.evidence);
    const keyed = Object.values(sheets.key).filter((k) => k.sheet === "evidence");
    expect(keyed).toHaveLength(rows("evidence").length);
  });

  it("puts simulator answers next to the brief, from non-Baseten runs", () => {
    const sim = rows("simulator");
    expect(sim).toHaveLength(6);
    const [row] = sim.filter((r) => r[5] === "Friday the 14th");
    expect(row).toBeDefined();
    expect(row![3]).toContain(":");
    expect(sim.some((r) => r[5] === "unsure")).toBe(true);
    for (const k of Object.values(sheets.key).filter((x) => x.sheet === "simulator")) {
      expect(k.provider).toBe("meta");
    }
  });
});

describe("importSheets", () => {
  const sheets = buildSheets(scenarios, logs, "seed-1");

  it("accepts a fully rated set and summarizes it per provider and condition", () => {
    const { ratings, problems } = importSheets(complete(sheets), sheets.key);
    expect(problems).toEqual([]);
    expect(ratings).toHaveLength(Object.keys(sheets.key).length);
    const summary = summarizeRatings(ratings, sheets.key);
    expect(summary.map((s) => s.condition)).toEqual([
      "baseten/paste/precise",
      "meta/paste/precise",
    ]);
    const meta = summary[1]!;
    expect(meta).toMatchObject({ questions: 3, clarityMean: 3, answerabilityMean: 2 });
    expect(meta.simulator).toEqual({ plausible: 0, of: 6 });
    const evidence = summary.reduce((n, s) => n + s.evidence.of, 0);
    expect(evidence).toBe(Math.ceil(36 * EVIDENCE_SAMPLE));
    expect(summary.every((s) => s.evidence.supported === s.evidence.of)).toBe(true);
  });

  it("refuses a sheet with the wrong header", () => {
    const done = complete(sheets);
    done.questions = done.questions.replace("clarity", "clearness");
    expect(importSheets(done, sheets.key).problems).toEqual([
      "questions.csv: header must be item,scenario,question,options,clarity,answerability,notes",
    ]);
  });

  it("refuses out-of-range scores, bad yes/no values and blank cells", () => {
    const done = complete(sheets);
    done.questions = edit(done.questions, set(4, "4"));
    done.evidence = edit(done.evidence, set(4, "maybe"));
    done.simulator = edit(done.simulator, set(6, ""));
    const { problems } = importSheets(done, sheets.key);
    expect(problems).toEqual([
      "questions.csv row 2: clarity and answerability must be 1, 2 or 3",
      "evidence.csv row 2: supports must be yes or no",
      "simulator.csv row 2: plausible must be yes or no",
    ]);
  });

  it("refuses unknown, duplicated, missing and misshapen rows", () => {
    const done = complete(sheets);
    const first = parseCsv(done.questions)[1]!;
    done.questions = edit(done.questions, ([a, , ...rest]) => [
      a!,
      a!,
      ["q-00000000", ...a!.slice(1)],
      a!.slice(0, 3),
      ...rest,
    ]);
    expect(importSheets(done, sheets.key).problems).toEqual([
      `questions.csv row 3: duplicate item ${first[0]}`,
      "questions.csv row 4: unknown item q-00000000",
      "questions.csv row 5: 3 cells, expected 7",
      "questions.csv: 1 items not rated",
    ]);
  });

  it("does not accept an item from another sheet", () => {
    const done = complete(sheets);
    const evidenceId = parseCsv(sheets.evidence)[1]![0]!;
    done.questions = edit(done.questions, set(0, evidenceId));
    expect(importSheets(done, sheets.key).problems).toContain(
      `questions.csv row 2: unknown item ${evidenceId}`,
    );
  });
});
