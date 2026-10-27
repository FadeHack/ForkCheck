import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "@forkcheck/core";
import { parseScenario } from "../src/index";

const root = new URL("../../../scenarios/", import.meta.url);
// Audio truth files live under audio/ and are not scenarios.
const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
  (f) => f.endsWith(".json") && !f.startsWith("audio"),
);

describe("scenario transcripts", () => {
  it("finds at least one scenario", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses with every speaker known", (file) => {
    const s = parseScenario(readFileSync(new URL(file, root), "utf8"));
    const { segments, warnings } = parseTranscript({
      meetingId: s.id,
      text: s.transcript,
      participants: s.participants.map((name) => ({ id: name, displayName: name })),
    });
    expect(warnings).toEqual([]);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((seg) => seg.participantId !== null)).toBe(true);
  });
});
