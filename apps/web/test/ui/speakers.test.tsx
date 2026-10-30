import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Meeting, Segment } from "@forkcheck/core";
import { SpeakersView } from "../../src/ui/organizer/speakers";
import { meeting, organizerState } from "./fixtures";

const text = (node: React.ReactElement) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const audio = { storageKey: "m1/f1", durationMs: 34_000, retain: false };

function view(
  status: Meeting["status"],
  { stored = true, error = null as string | null, segments = [] as Segment[] } = {},
) {
  const state = organizerState({
    meeting: { ...meeting, source: "audio", status, error, transcriptVersion: 0 },
    audio: stored ? audio : null,
    segments,
  });
  return text(<SpeakersView state={state} />);
}

const segment = (idx: number, speakerLabel: string | null): Segment => ({
  id: `m1:seg:${idx}`,
  meetingId: "m1",
  idx,
  speakerLabel,
  participantId: null,
  startMs: idx * 1000,
  endMs: idx * 1000 + 900,
  text: "We ship SSO on Friday.",
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

  it("counts turns per voice once transcribed", () => {
    const out = view("review", {
      segments: [segment(0, "A"), segment(1, "B"), segment(2, "A"), segment(3, null)],
    });
    expect(out).toContain("Transcribed 34 s of audio: 4 turns from 3 voices.");
    expect(out).toContain("Speaker A: 2 turns");
    expect(out).toContain("Speaker B: 1 turn");
    expect(out).toContain("No speaker label: 1 turn");
  });
});
