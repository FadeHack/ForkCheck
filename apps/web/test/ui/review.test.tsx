import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Segment } from "@forkcheck/core";
import type { OrganizerMeetingState } from "../../src/contracts/api";
import { checkReasons, ReviewView } from "../../src/ui/organizer/review";
import { meeting, organizerState, participants } from "./fixtures";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const audio = { storageKey: "m1/f1", durationMs: 34_000, retain: false };

const segment = (idx: number, speakerLabel: string | null, words = `Turn ${idx}.`): Segment => ({
  id: `m1:seg:${idx}`,
  meetingId: "m1",
  idx,
  speakerLabel,
  participantId: null,
  startMs: idx * 10_000,
  endMs: idx * 10_000 + 900,
  text: words,
  origin: "asr",
  edited: false,
});

function render(overrides: Partial<OrganizerMeetingState> = {}): string {
  const state = organizerState({
    meeting: { ...meeting, source: "audio", status: "review", transcriptVersion: 1 },
    audio,
    ...overrides,
  });
  return renderToStaticMarkup(<ReviewView state={state} />);
}

describe("checkReasons", () => {
  it("finds dates, participants' names and numbers", () => {
    expect(checkReasons("We ship on Friday.", participants)).toEqual(["date"]);
    expect(checkReasons("Due 14 March.", participants)).toEqual(["date", "number"]);
    expect(checkReasons("priya owns it", participants)).toEqual(["name"]);
    expect(checkReasons("About twenty seats.", participants)).toEqual(["number"]);
    expect(checkReasons("Sounds good, we may march on.", participants)).toEqual([]);
  });
});

describe("ReviewView", () => {
  it("names mapped voices, says Unknown where the organizer did, and marks the rest", () => {
    const segments = [segment(0, "A"), segment(1, "B"), segment(2, "C"), segment(3, null)];
    segments[0] = { ...segments[0]!, participantId: "p0" };
    const out = text(
      render({
        segments,
        speakers: [
          { label: "A", participantId: "p0" },
          { label: "B", participantId: null },
        ],
      }),
    );
    expect(out).toContain("Priya at 00:00 Turn 0.");
    expect(out).toContain("Unknown speaker at 00:10 Turn 1.");
    expect(out).toContain("Speaker C (unmapped) at 00:20 Turn 2.");
    expect(out).toContain("Unknown speaker at 00:30 Turn 3.");
    expect(out).toContain("Edits are logged and marked in the record.");
  });

  it("outlines turns with a date, name or number and says what to check", () => {
    const html = render({
      segments: [segment(0, "A", "Marco ships it Friday."), segment(1, "A", "Fine.")],
    });
    expect(html.match(/turn turn-check/g)).toHaveLength(1);
    const out = text(html);
    expect(out).toContain("1 turn mentions a date, name or number.");
    expect(out).toContain("Check the date and name.");
  });

  it("marks edited turns and lists each change with its before and after", () => {
    const s = { ...segment(0, "A", "We ship on Monday."), participantId: "p1", edited: true };
    const out = text(
      render({
        segments: [s],
        edits: [
          {
            id: "e1",
            segmentId: s.id,
            field: "text",
            before: "We ship on Sunday.",
            after: "We ship on Monday.",
            at: "2026-10-27T20:00:00.000Z",
          },
          {
            id: "e2",
            segmentId: s.id,
            field: "participantId",
            before: null,
            after: "p1",
            at: "2026-10-27T20:01:00.000Z",
          },
        ],
      }),
    );
    expect(out).toContain("Marco at 00:00 Edited");
    expect(out).toContain("2 changes");
    expect(out).toContain("Words changed from “We ship on Sunday.” to “We ship on Monday.”");
    expect(out).toContain("Speaker changed from Unknown speaker to Marco");
  });

  it("offers to keep the recording, and says it will be deleted otherwise", () => {
    const out = text(render({ segments: [segment(0, "A")] }));
    expect(out).toContain("Keep the recording so quotes in the record can be played back");
    expect(out).toContain("The audio file will be deleted now.");
    expect(out).toContain("Play from 00:00");
  });

  it("drops the choice and the play buttons once the recording is gone", () => {
    const out = text(render({ segments: [segment(0, "A")], audio: null }));
    expect(out).not.toContain("Keep the recording");
    expect(out).not.toContain("will be deleted");
    expect(out).not.toContain("Play from");
    expect(out).toContain("Finish review");
  });
});
