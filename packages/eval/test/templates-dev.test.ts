import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { templateProbe, type Dimension } from "@forkcheck/core";
import { parseScenario, scenarioExtractInput } from "../src/index";

const devDir = new URL("../../../scenarios/dev/", import.meta.url);
const dev = readdirSync(devDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => parseScenario(readFileSync(new URL(f, devDir), "utf8")));

// Every dev decision with an owner or a deadline phrase gets a T0 probe that passes lint
// against the real transcript turns.
const cases = dev.flatMap((s) => {
  const { meeting, participants, segments } = scenarioExtractInput(s);
  return s.expectedDecisions.flatMap((d) => {
    const dimensions: Dimension[] = [
      ...(d.owner ? (["owner"] as const) : []),
      ...(d.deadline ? (["deadline"] as const) : []),
    ];
    return dimensions.map((dimension) => ({
      name: `${s.id} ${d.id} ${dimension}`,
      input: {
        meeting,
        participants,
        segments,
        decision: {
          id: d.id,
          status: "ambiguous" as const,
          statement: d.statement,
          ownerText: d.owner,
          deadlineText: d.deadline,
        },
        candidate: {
          id: `${d.id}-${dimension}`,
          dimension,
          readings: [
            { id: "r0", text: "one reading" },
            { id: "r1", text: "another reading" },
          ],
        },
      },
    }));
  });
});

describe("T0 templates on the dev scenarios", () => {
  it("covers every decision with an owner or deadline phrase", () => {
    expect(cases).toHaveLength(46);
  });

  it.each(cases)("$name passes lint", ({ input }) => {
    const probe = templateProbe(input);
    expect(probe?.lint).toEqual([]);
  });
});
