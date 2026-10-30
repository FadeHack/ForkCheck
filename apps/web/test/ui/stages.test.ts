import { describe, expect, it } from "vitest";
import { organizerStage, participantStage, recheckMayFollow, stagesFor } from "../../src/ui/stages";
import { viewedStage } from "../../src/ui/organizer/workspace";
import { organizerStages } from "../../src/ui/stages";
import { answer, meeting, organizerState, participantState, probe, round, split } from "./fixtures";

const closed = { closedAt: "2026-10-27T21:00:00.000Z", closeReason: "all_answered" as const };

describe("audio stages", () => {
  const audio = (overrides: Partial<typeof meeting>) =>
    organizerState({ meeting: { ...meeting, source: "audio", ...overrides } });

  it("lists Speakers and Transcript review only for a recording", () => {
    expect(stagesFor({ source: "paste" }).map((s) => s.id)).not.toContain("speakers");
    expect(
      stagesFor({ source: "audio" })
        .map((s) => s.id)
        .slice(0, 4),
    ).toEqual(["source", "speakers", "review", "questions"]);
  });

  it("is speakers until there is a transcript and every voice is mapped, then review", () => {
    for (const status of ["draft", "transcribing", "failed"] as const) {
      expect(organizerStage(audio({ status, transcriptVersion: 0 }))).toBe("speakers");
    }
    const turn = (idx: number, speakerLabel: string) => ({
      id: `s${idx}`,
      meetingId: "m1",
      idx,
      speakerLabel,
      participantId: null,
      startMs: idx * 1000,
      endMs: null,
      text: "Yes.",
      origin: "asr" as const,
      edited: false,
    });
    const transcribed = (speakers: { label: string; participantId: string | null }[]) =>
      organizerState({
        meeting: { ...meeting, source: "audio", status: "review", transcriptVersion: 1 },
        segments: [turn(0, "A"), turn(1, "B")],
        speakers,
      });
    expect(organizerStage(transcribed([]))).toBe("speakers");
    expect(organizerStage(transcribed([{ label: "A", participantId: "p0" }]))).toBe("speakers");
    expect(
      organizerStage(
        transcribed([
          { label: "A", participantId: "p0" },
          { label: "B", participantId: null },
        ]),
      ),
    ).toBe("review");
  });

  it("leaves an analysis failure after transcription to the questions stage", () => {
    expect(organizerStage(audio({ status: "failed", transcriptVersion: 1 }))).toBe("questions");
  });

  it("never opens an audio stage for a pasted meeting", () => {
    expect(viewedStage("questions", "speakers", stagesFor({ source: "paste" }))).toBe("questions");
  });
});

describe("organizerStage", () => {
  it("is questions before any round opens", () => {
    expect(organizerStage(organizerState())).toBe("questions");
  });

  it("is round while the diagnostic round is open", () => {
    expect(organizerStage(organizerState({ rounds: [round("r1")] }))).toBe("round");
  });

  it("is reveal once the round closes with an open split", () => {
    const state = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1")],
    });
    expect(organizerStage(state)).toBe("reveal");
  });

  it("is resolve once wording has been proposed", () => {
    const state = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { status: "resolving" })],
    });
    expect(organizerStage(state)).toBe("resolve");
  });

  it("is recheck once a split is confirmed or a recheck round is open", () => {
    const confirmed = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { status: "confirmed" })],
    });
    expect(organizerStage(confirmed)).toBe("recheck");
  });

  it("is record when every split is settled, or when nothing split", () => {
    const settled = organizerState({
      probes: [probe("q1"), probe("q2")],
      rounds: [round("r1", closed)],
      splits: [
        split("s1", "q1", { status: "rechecked" }),
        split("s2", "q2", { status: "unresolved" }),
      ],
    });
    expect(organizerStage(settled)).toBe("record");
    const agreed = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { outcome: "consistent" })],
    });
    expect(organizerStage(agreed)).toBe("record");
  });

  it("ignores splits from recheck questions", () => {
    const state = organizerState({
      probes: [probe("q1"), probe("rq", { kind: "recheck", splitId: "s1" })],
      rounds: [round("r1", closed), round("r2", { ...closed, kind: "recheck" })],
      splits: [split("s1", "q1", { status: "rechecked" }), split("s2", "rq")],
    });
    expect(organizerStage(state)).toBe("record");
  });
});

describe("a recheck without enough answers", () => {
  const state = (outcome: "insufficient" | "split") =>
    organizerState({
      probes: [probe("q1"), probe("rq", { kind: "recheck", splitId: "s1" })],
      rounds: [round("r1", closed), round("r2", { ...closed, kind: "recheck" })],
      splits: [
        split("s1", "q1", { status: "confirmed" }),
        split("s2", "rq", { outcome, status: "confirmed" }),
      ],
    });

  it("leaves the wording confirmed for good, so the meeting moves on to the record", () => {
    expect(organizerStage(state("insufficient"))).toBe("record");
  });

  it("doesn't settle wording confirmed again after an earlier recheck reopened it", () => {
    expect(organizerStage(state("split"))).toBe("recheck");
  });
});

describe("viewedStage", () => {
  it("shows an earlier stage on request, never a later one or the source", () => {
    expect(viewedStage("reveal", "questions", organizerStages)).toBe("questions");
    expect(viewedStage("reveal", "record", organizerStages)).toBe("reveal");
    expect(viewedStage("reveal", "source", organizerStages)).toBe("reveal");
    expect(viewedStage("reveal", "nonsense", organizerStages)).toBe("reveal");
    expect(viewedStage("reveal", null, organizerStages)).toBe("reveal");
  });
});

describe("participantStage", () => {
  const open = { id: "q1", kind: "diagnostic" as const, splitId: null, stem: "Q", options: [] };

  it("is not_started before any question is sent", () => {
    expect(participantStage(participantState())).toBe("not_started");
  });

  it("is answer with an unanswered question, waiting once all are answered", () => {
    expect(participantStage(participantState({ openProbes: [open] }))).toBe("answer");
    const answered = participantState({
      openProbes: [open],
      ownAnswers: [answer("p0", "q1", null)],
    });
    expect(participantStage(answered)).toBe("waiting");
  });

  it("is recheck when the open question is a recheck", () => {
    const state = participantState({ openProbes: [{ ...open, kind: "recheck" }] });
    expect(participantStage(state)).toBe("recheck");
  });

  it("is reveal until every split is confirmed or settled, then record", () => {
    const revealed = (status: "open" | "rechecked") => ({
      split: split("s1", "q1", { status }),
      probe: open,
      quote: null,
      answers: [],
      resolutions: [],
      confirmations: [],
    });
    expect(participantStage(participantState({ revealed: [revealed("open")] }))).toBe("reveal");
    expect(participantStage(participantState({ revealed: [revealed("rechecked")] }))).toBe(
      "record",
    );
    const inconclusive = {
      ...revealed("open"),
      split: split("s2", "rq", { outcome: "insufficient", status: "confirmed" }),
      probe: { ...open, id: "rq", kind: "recheck" as const, splitId: "s1" },
    };
    const confirmed = { ...revealed("open"), split: split("s1", "q1", { status: "confirmed" }) };
    expect(participantStage(participantState({ revealed: [confirmed] }))).toBe("record");
    expect(participantStage(participantState({ revealed: [confirmed, revealed("open")] }))).toBe(
      "reveal",
    );
    expect(participantStage(participantState({ revealed: [confirmed, inconclusive] }))).toBe(
      "record",
    );
    expect(recheckMayFollow(participantState({ revealed: [confirmed] }))).toBe(true);
    expect(recheckMayFollow(participantState({ revealed: [confirmed, inconclusive] }))).toBe(false);
    expect(recheckMayFollow(participantState({ revealed: [revealed("rechecked")] }))).toBe(false);
  });
});
