import { describe, expect, it } from "vitest";
import { decisionsSummary } from "../../src/ui/organizer/questions";

describe("decisionsSummary", () => {
  it("counts the decisions open to more than one reading", () => {
    expect(decisionsSummary(["ambiguous", "clear", "ambiguous"])).toBe(
      "3 decisions, 2 of them open to more than one reading.",
    );
  });

  it("says when none or all are open", () => {
    expect(decisionsSummary(["clear", "clear"])).toBe(
      "2 decisions, none open to more than one reading.",
    );
    expect(decisionsSummary(["ambiguous", "ambiguous"])).toBe(
      "2 decisions, all open to more than one reading.",
    );
  });

  it("uses the singular for one decision", () => {
    expect(decisionsSummary(["ambiguous"])).toBe(
      "1 decision, it is open to more than one reading.",
    );
    expect(decisionsSummary(["clear"])).toBe("1 decision, none open to more than one reading.");
  });
});
