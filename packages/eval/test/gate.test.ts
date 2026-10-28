import { describe, expect, it } from "vitest";
import {
  gateLog,
  gateVerdict,
  renderGateReport,
  scoreGateScenario,
  type GateLog,
} from "../src/index";

type Outcome = "split" | "consistent" | "insufficient";

/** A scenario log whose probes are listed as [mismatch id or null, outcome]. */
function log(
  run: number,
  scenario: string,
  planted: GateLog["planted"],
  probes: [string | null, Outcome][],
): GateLog {
  return gateLog.parse({
    runId: "test",
    run,
    scenario,
    tier: "free",
    planted,
    candidates: probes.map(([mismatch], i) => ({
      id: `c${i}`,
      dimension: planted.find((m) => m.id === mismatch)?.dimension ?? "scope",
      mismatch,
      probeId: `p${i}`,
    })),
    rounds: probes.map(([, outcome], i) => ({
      probeId: `p${i}`,
      stem: `Question ${i}?`,
      divergence: { outcome },
    })),
    costUsd: 0.01,
  });
}

const mismatchIds = ["m1", "m2", "m3", "m4", "m5", "m6"];
const dims = ["deadline", "deadline", "owner", "scope", "criteria", "scope"] as const;

/** One run of the 6+2 set: `revealed` mismatch scenarios split on their planted probe. */
function run(n: number, revealed: number, controlSplits: [number, number]): GateLog[] {
  const mismatch = mismatchIds.map((id, i) =>
    log(
      n,
      `s-${id}`,
      [{ id, dimension: dims[i]! }],
      [
        [id, i < revealed ? "split" : "consistent"],
        [null, "consistent"],
      ],
    ),
  );
  const controls = controlSplits.map((splits, i) =>
    log(
      n,
      `control-${i}`,
      [],
      [
        ...Array.from({ length: splits }, () => [null, "split"] as [null, Outcome]),
        [null, "consistent"],
      ],
    ),
  );
  return [...mismatch, ...controls];
}

describe("scoreGateScenario", () => {
  it("counts a planted mismatch only when its own probe split", () => {
    const s = scoreGateScenario(
      log(
        0,
        "s",
        [{ id: "m1", dimension: "deadline" }],
        [
          ["m1", "consistent"],
          [null, "split"],
        ],
      ),
    );
    expect(s).toMatchObject({ revealed: [], missed: ["m1"], unplantedSplits: 1, probes: 2 });
  });

  it("an insufficient round is not a reveal", () => {
    const s = scoreGateScenario(
      log(0, "s", [{ id: "m1", dimension: "owner" }], [["m1", "insufficient"]]),
    );
    expect(s.missed).toEqual(["m1"]);
  });
});

describe("gateVerdict", () => {
  it("GO: every run reveals 5 of 6 with one control false split", () => {
    const v = gateVerdict([...run(0, 5, [1, 0]), ...run(1, 6, [0, 0]), ...run(2, 5, [0, 1])]);
    expect(v.go).toBe(true);
    expect(v.runs.map((r) => [r.revealed, r.overall, r.controlFalseSplits, r.go])).toEqual([
      [5, 6, 1, true],
      [6, 8, 0, true],
      [5, 6, 1, true],
    ]);
    expect(v.byDimension.deadline).toEqual({ revealed: 6, of: 6 });
    expect(v.byDimension.scope).toEqual({ revealed: 4, of: 6 });
    expect(v.costUsd).toBeCloseTo(0.24);
  });

  it("NO-GO: too few reveals", () => {
    const v = gateVerdict([...run(0, 4, [0, 0]), ...run(1, 4, [0, 0]), ...run(2, 6, [0, 0])]);
    expect(v.go).toBe(false);
    expect(v.runs[0]!.reasons).toEqual(["revealed 4/6, needs 5"]);
  });

  it("NO-GO: two false splits in the controls fail a run even with every reveal", () => {
    const v = gateVerdict([...run(0, 6, [2, 0]), ...run(1, 6, [1, 1]), ...run(2, 6, [0, 0])]);
    expect(v.go).toBe(false);
    expect(v.runs.map((r) => r.go)).toEqual([false, false, true]);
    expect(v.runs[0]!.reasons).toEqual(["2 false splits in controls, allows 1"]);
    expect(v.runs[1]).toMatchObject({ overall: 6, controlFalseSplits: 2 });
  });

  it("NO-GO: overall below 6 even when reveals pass", () => {
    const v = gateVerdict(run(0, 5, [1, 1]));
    expect(v.runs[0]).toMatchObject({ revealed: 5, overall: 5, go: false });
    expect(v.runs[0]!.reasons).toEqual([
      "overall 5/8, needs 6",
      "2 false splits in controls, allows 1",
    ]);
  });

  it("a majority of runs decides", () => {
    expect(gateVerdict([...run(0, 6, [0, 0]), ...run(1, 6, [0, 0]), ...run(2, 0, [3, 3])]).go).toBe(
      true,
    );
    expect(gateVerdict([...run(0, 6, [0, 0]), ...run(1, 0, [0, 0]), ...run(2, 0, [0, 0])]).go).toBe(
      false,
    );
  });

  it("a run with a scenario missing fails", () => {
    const v = gateVerdict(run(0, 6, [0, 0]).slice(1));
    expect(v.go).toBe(false);
    expect(v.runs[0]!.reasons[0]).toBe(
      "set has 5 mismatch and 2 control scenarios, expected 6 and 2",
    );
  });

  it("no logs is NO-GO", () => {
    expect(gateVerdict([]).go).toBe(false);
  });

  it("renders the verdict and per-run rows", () => {
    const logs = run(0, 5, [1, 0]);
    const md = renderGateReport(gateVerdict(logs), logs);
    expect(md).toMatch(/^# Gate G1: GO\n/);
    expect(md).toContain("| 0 | 5/6 | 6/8 | 1 | pass |");
    expect(md).toContain("| control-0 | control | 0/1 | 2 | 1 |");
  });
});
