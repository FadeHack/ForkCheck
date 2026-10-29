import { describe, expect, it } from "vitest";
import { lintNote, nameList, waitingLine } from "../../src/ui/labels";

describe("lintNote", () => {
  it.each([
    ["option_count", "5 options; need 2 to 4", "Has 5 options. A question needs 2 to 4 options."],
    ["length_ratio", "longest option is 3.10× the shortest; max 2.5×", "One option is much longer"],
    [
      "verbatim_speaker",
      'option 2 repeats "ready by Friday for sure"',
      'Option 2 repeats what someone said ("ready by Friday for sure")',
    ],
    [
      "presupposition",
      'stem uses "disagree"',
      'Uses the word "disagree", which presumes the answer.',
    ],
    ["one_dimension", "stem asks 2 questions", "Asks about more than one thing."],
    ["debated_target", "decision d1 is debated", "the meeting was still debating"],
    [
      "duplicate",
      "probe 2 repeats probe 1 on d1/scope",
      "Asks the same thing as another question.",
    ],
  ])("%s reads as a sentence with the fix", (rule, detail, expected) => {
    const note = lintNote({ rule, detail });
    expect(note).toContain(expected);
    expect(note).not.toMatch(/\bd1\b|×|probe \d/);
  });

  it("falls back to the detail for a rule it doesn't know", () => {
    expect(lintNote({ rule: "new_rule", detail: "Something specific." })).toBe(
      "Something specific.",
    );
  });
});

describe("waitingLine", () => {
  it("names who is left in plain English", () => {
    expect(nameList(["Dana"])).toBe("Dana");
    expect(nameList(["Dana", "Leo"])).toBe("Dana and Leo");
    expect(waitingLine(["Dana", "Leo", "Sam"])).toBe("Waiting for Dana, Leo and Sam.");
    expect(waitingLine([])).toBe(
      "Everyone has answered. Answers show here once the organizer reveals them.",
    );
  });
});
