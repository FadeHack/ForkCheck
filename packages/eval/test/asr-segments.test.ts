import { readFileSync } from "node:fs";
import { toSegments, transcribeResponse } from "@forkcheck/asr";
import { segment } from "@forkcheck/core";
import { describe, expect, it } from "vitest";

describe("ASR segments", () => {
  it("satisfy the core Segment schema", () => {
    const path = new URL("../../asr/fixtures/diarization-probe.json", import.meta.url);
    const response = transcribeResponse.parse(JSON.parse(readFileSync(path, "utf8")));
    let n = 0;
    const { segments } = toSegments(response, { meetingId: "m1", newId: () => `s${++n}` });
    for (const s of segments) expect(segment.parse(s)).toEqual(s);
  });
});
