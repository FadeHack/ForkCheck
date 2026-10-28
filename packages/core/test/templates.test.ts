import { describe, expect, it } from "vitest";
import {
  deadlineFirmnessTemplate,
  deadlineWords,
  FIRMNESS_OPTIONS,
  NO_OWNER_OPTION,
  ownerOptions,
  ownerTemplate,
  templateProbe,
  withoutNames,
  type Dimension,
  type TemplateInput,
} from "../src/index";

const people = (...names: string[]) =>
  names.map((displayName, i): TemplateInput["participants"][number] => ({
    id: `p${i}`,
    displayName,
    status: "active",
  }));

function input(
  over: Partial<Omit<TemplateInput, "decision" | "candidate">> & {
    statement?: string;
    ownerText?: string | null;
    deadlineText?: string | null;
    dimension?: Dimension;
    readings?: string[];
  } = {},
): TemplateInput {
  return {
    meeting: over.meeting ?? {
      id: "m1",
      heldAt: "2026-10-27T15:00:00Z",
      timezone: "America/New_York",
    },
    participants: over.participants ?? people("Priya", "Marco", "Dana"),
    decision: {
      id: "d1",
      status: "ambiguous",
      statement: over.statement ?? "Priya sends the outage email to affected customers by Friday.",
      ownerText: over.ownerText === undefined ? "Priya" : over.ownerText,
      deadlineText: over.deadlineText === undefined ? "by Friday" : over.deadlineText,
    },
    candidate: {
      id: "c1",
      dimension: over.dimension ?? "owner",
      readings: (over.readings ?? ["Priya sends it", "Marco sends it"]).map((text, i) => ({
        id: `r${i}`,
        text,
      })),
    },
    segments: over.segments ?? [{ text: "Priya: I can draft it, Marco owns comms though." }],
  };
}

describe("ownerTemplate", () => {
  it("snapshot: three people, the stem names nobody", () => {
    const p = ownerTemplate(input());
    expect(p.stem).not.toMatch(/Priya|Marco|Dana/);
    expect(p.lint).toEqual([]);
    expect({ stem: p.stem, options: p.options, tier: p.tier }).toMatchInlineSnapshot(`
      {
        "options": [
          {
            "id": "c1:t0:opt:0",
            "text": "Priya does it",
          },
          {
            "id": "c1:t0:opt:1",
            "text": "Marco does it",
          },
          {
            "id": "c1:t0:opt:2",
            "text": "Dana does it",
          },
          {
            "id": "c1:t0:opt:3",
            "text": "No one is named yet",
          },
        ],
        "stem": "For "Someone sends the outage email to affected customers by Friday", who does it on the day it happens?",
        "tier": "template",
      }
    `);
  });

  it("two people get a shared option", () => {
    expect(ownerOptions(input({ participants: people("Ana", "Bo") }))).toEqual([
      "Ana does it",
      "Bo does it",
      NO_OWNER_OPTION,
      "Ana and Bo share it",
    ]);
  });

  it("four people: the mentioned come first and the option limit holds", () => {
    const opts = ownerOptions(
      input({
        participants: people("Ana", "Bo", "Cy", "Dee"),
        ownerText: null,
        readings: ["Dee sends it", "Bo sends it"],
      }),
    );
    expect(opts).toEqual(["Bo does it", "Dee does it", "Ana does it", NO_OWNER_OPTION]);
  });

  it("absent participants are not offered", () => {
    const participants = [...people("Ana", "Bo", "Cy")];
    participants[2] = { ...participants[2]!, status: "absent" as const };
    expect(ownerOptions(input({ participants }))).not.toContain("Cy does it");
  });

  it("withoutNames replaces whole names only, possessives included", () => {
    expect(withoutNames("Zara's team runs QA with Zarah", ["Zara"])).toBe(
      "Someone's team runs QA with Zarah",
    );
    expect(withoutNames("Bashir sends Chiara the list", ["Chiara", "Bashir"])).toBe(
      "Someone sends someone else the list",
    );
  });
});

describe("deadlineFirmnessTemplate", () => {
  it("snapshot: a single reading is written as a date and the phrase leaves the item", () => {
    const p = deadlineFirmnessTemplate(input({ dimension: "deadline" }))!;
    expect(p.lint).toEqual([]);
    expect({ stem: p.stem, options: p.options.map((o) => o.text) }).toMatchInlineSnapshot(`
      {
        "options": [
          "Still on time",
          "Late but acceptable",
          "A missed commitment",
        ],
        "stem": "For "Priya sends the outage email to affected customers", if it lands two working days after Friday, October 30, how does that count?",
      }
    `);
  });

  it("an ambiguous phrase is quoted as said", () => {
    expect(deadlineWords("next Friday", "2026-10-27T15:00:00Z", "America/New_York")).toBe(
      '"next Friday"',
    );
    expect(deadlineWords("by next Friday", "2026-10-27T15:00:00Z", "America/New_York")).toBe(
      '"next Friday"',
    );
  });

  it("null without a deadline phrase", () => {
    expect(deadlineFirmnessTemplate(input({ dimension: "deadline", deadlineText: null }))).toBe(
      null,
    );
  });

  it("options are the fixed firmness scale", () => {
    expect(deadlineFirmnessTemplate(input())!.options.map((o) => o.text)).toEqual(FIRMNESS_OPTIONS);
  });
});

describe("templateProbe", () => {
  it("has no template for the other dimensions", () => {
    for (const dimension of ["scope", "criteria", "dependency", "outcome"] as const) {
      expect(templateProbe(input({ dimension }))).toBe(null);
    }
  });

  it("is deterministic", () => {
    expect(templateProbe(input())).toEqual(templateProbe(input()));
  });
});
