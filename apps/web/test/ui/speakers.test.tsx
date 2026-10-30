import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Meeting, Segment } from "@forkcheck/core";
import type { OrganizerMeetingState } from "../../src/contracts/api";
import { sampleTurns, SpeakersView } from "../../src/ui/organizer/speakers";
import { meeting, organizerState } from "./fixtures";

const text = (node: React.ReactElement) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const audio = { storageKey: "m1/f1", durationMs: 34_000, retain: false };

function view(
  status: Meeting["status"],
  {
    stored = true,
    error = null as string | null,
    segments = [] as Segment[],
    speakers = [] as OrganizerMeetingState["speakers"],
  } = {},
) {
  const state = organizerState({
    meeting: {
      ...meeting,
      source: "audio",
      status,
      error,
      transcriptVersion: segments.length > 0 ? 1 : 0,
    },
    audio: stored ? audio : null,
    segments,
    speakers,
  });
  return text(<SpeakersView state={state} />);
}

const segment = (idx: number, speakerLabel: string | null, ms = 900): Segment => ({
  id: `m1:seg:${idx}`,
  meetingId: "m1",
  idx,
  speakerLabel,
  participantId: null,
  startMs: idx * 10_000,
  endMs: idx * 10_000 + ms,
  text: `Turn ${idx}.`,
  origin: "asr",
  edited: false,
});

describe("SpeakersView", () => {
  it("says transcription is running", () => {
    expect(view("transcribing")).toContain(
      "Transcribing the recording. This page updates when it's done.",
    );
  });

  it("shows the failure, a retry and a fresh upload after transcription fails", () => {
    const out = view("failed", { error: "The recording has no audio track." });
    expect(out).toContain("Transcription failed. The recording has no audio track.");
    expect(out).toContain("Start transcription again");
    expect(out).toContain("Upload a different recording");
  });

  it("offers to start an uploaded recording that was never transcribed", () => {
    const out = view("draft");
    expect(out).toContain("The recording is uploaded but hasn't been transcribed yet.");
    expect(out).toContain("Start transcription");
    expect(out).not.toContain("Transcription failed.");
  });

  it("asks for the recording when none is stored", () => {
    const out = view("draft", { stored: false });
    expect(out).toContain("Upload the recording");
    expect(out).toContain("Upload and transcribe");
    expect(out).not.toContain("Start transcription");
  });

  it("asks who each voice is, with turns to play, once transcribed", () => {
    const out = view("review", {
      segments: [segment(0, "A"), segment(1, "B"), segment(2, "A"), segment(3, null)],
    });
    expect(out).toContain("Transcribed 34 s of audio: 4 turns from 2 voices.");
    expect(out).toContain("Speaker A (2 turns)");
    expect(out).toContain("Speaker B (1 turn)");
    expect(out).toContain("Who is Speaker A?");
    expect(out).toContain("Play from 00:10");
    expect(out).toContain("Save speakers");
    expect(out).not.toContain("Map every speaker");
  });

  it("starts each choice from the saved mapping, and plays nothing once audio is gone", () => {
    const html = renderToStaticMarkup(
      <SpeakersView
        state={organizerState({
          meeting: { ...meeting, source: "audio", status: "review", transcriptVersion: 1 },
          segments: [segment(0, "A"), segment(1, "B")],
          speakers: [
            { label: "A", participantId: "p1" },
            { label: "B", participantId: null },
          ],
        })}
      />,
    );
    expect(html).toMatch(/<option value="p1" selected="">Marco<\/option>/);
    expect(html).toMatch(/<option value="unknown" selected="">Unknown<\/option>/);
    expect(html).toContain("turns can&#x27;t be played");
    expect(html).not.toContain("Play from");
  });

  it("lists the saved mapping once questions are drafted", () => {
    const out = view("probing", {
      segments: [segment(0, "A"), segment(1, "B")],
      speakers: [
        { label: "A", participantId: "p0" },
        { label: "B", participantId: null },
      ],
    });
    expect(out).toContain("Speaker A: Priya");
    expect(out).toContain("Speaker B: Unknown");
    expect(out).not.toContain("Save speakers");
  });
});

describe("sampleTurns", () => {
  it("keeps the three longest turns in transcript order", () => {
    const turns = [segment(0, "A", 500), segment(1, "A", 4000), segment(2, "A", 900)];
    turns.push(segment(3, "A", 3000), segment(4, "A", 100));
    expect(sampleTurns(turns).map((t) => t.idx)).toEqual([1, 2, 3]);
  });
});
