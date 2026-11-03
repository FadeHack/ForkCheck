import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_MEETING } from "../../src/ui/start/sample";
import { wallTimeToInstant } from "../../src/ui/time";

const scenario = JSON.parse(
  readFileSync(new URL("../../../../scenarios/demo/atlas-launch.json", import.meta.url), "utf8"),
) as {
  title: string;
  heldAt: string;
  timezone: string;
  participants: string[];
  transcript: string;
};

describe("SAMPLE_MEETING", () => {
  it("is the demo scenario, so its recorded model replies still match", () => {
    expect(SAMPLE_MEETING.title).toBe(scenario.title);
    expect(SAMPLE_MEETING.timezone).toBe(scenario.timezone);
    expect([...SAMPLE_MEETING.participants]).toEqual(scenario.participants);
    expect(SAMPLE_MEETING.transcript).toBe(scenario.transcript);
    expect(Date.parse(wallTimeToInstant(SAMPLE_MEETING.heldAt, SAMPLE_MEETING.timezone)!)).toBe(
      Date.parse(scenario.heldAt),
    );
  });
});
