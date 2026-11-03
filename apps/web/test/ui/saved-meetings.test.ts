import { describe, expect, it } from "vitest";
import { parseSaved } from "../../src/ui/saved-meetings";

const meeting = {
  id: "m1",
  token: "t",
  title: "Atlas launch sync",
  heldAt: "2026-11-03T15:00:00.000Z",
  timezone: "America/New_York",
  savedAt: "2026-11-03T16:00:00.000Z",
};

describe("parseSaved", () => {
  it("keeps meetings with or without participant links", () => {
    const withLinks = {
      ...meeting,
      id: "m2",
      participants: [{ participantId: "p1", name: "Nadia", url: "http://localhost/p/x" }],
    };
    expect(parseSaved(JSON.stringify([meeting, withLinks]))).toEqual([meeting, withLinks]);
  });

  it("drops malformed entries and unreadable storage", () => {
    const badLinks = { ...meeting, participants: [{ name: "Nadia" }] };
    expect(parseSaved(JSON.stringify([badLinks, { id: "m3" }, meeting]))).toEqual([meeting]);
    expect(parseSaved("not json")).toEqual([]);
    expect(parseSaved(null)).toEqual([]);
  });
});
