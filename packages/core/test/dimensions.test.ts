import { describe, expect, it } from "vitest";
import {
  checkedDimensionsNote,
  dimension,
  NARROWED_DIMENSIONS,
  parseProbeDimensions,
} from "../src/index";

describe("parseProbeDimensions", () => {
  it("checks every dimension when unset, empty or all", () => {
    for (const raw of [undefined, "", " all "]) {
      expect(parseProbeDimensions(raw)).toEqual(dimension.options);
    }
  });

  it("reads narrow as the fallback set", () => {
    expect(parseProbeDimensions("narrow")).toEqual(["owner", "deadline", "scope"]);
  });

  it("reads a list in catalog order without duplicates", () => {
    expect(parseProbeDimensions("scope, owner,scope")).toEqual(["owner", "scope"]);
  });

  it("rejects an unknown name", () => {
    expect(() => parseProbeDimensions("owner,deadlines")).toThrow(/deadlines/);
  });
});

describe("checkedDimensionsNote", () => {
  it("says nothing when every dimension is checked", () => {
    expect(checkedDimensionsNote(dimension.options)).toBeNull();
  });

  it("names what is checked and what is not", () => {
    expect(checkedDimensionsNote(NARROWED_DIMENSIONS)).toBe(
      "Questions only cover Owner, Deadline and Scope. ForkCheck doesn't ask about acceptance criteria, dependency or expected outcome, so differences there won't show up.",
    );
  });
});
