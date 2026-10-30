import { speakersMapped, type Meeting, type Split, type SplitStatus } from "@forkcheck/core";
import type { OrganizerMeetingState, ParticipantState } from "../contracts/api";

export const organizerStages = [
  { id: "source", label: "Source" },
  { id: "speakers", label: "Speakers" },
  { id: "review", label: "Transcript review" },
  { id: "questions", label: "Questions" },
  { id: "round", label: "Round" },
  { id: "reveal", label: "Reveal" },
  { id: "resolve", label: "Resolve" },
  { id: "recheck", label: "Recheck" },
  { id: "record", label: "Record" },
] as const;
export type OrganizerStage = (typeof organizerStages)[number]["id"];
export type StageList = readonly (typeof organizerStages)[number][];

const AUDIO_ONLY: ReadonlySet<OrganizerStage> = new Set(["speakers", "review"]);

/** A pasted transcript has no voices to name and nothing misheard, so it skips the audio stages. */
export function stagesFor(meeting: Pick<Meeting, "source">): StageList {
  return meeting.source === "audio"
    ? organizerStages
    : organizerStages.filter((s) => !AUDIO_ONLY.has(s.id));
}

/** Split states that need nothing more from anyone. */
const SETTLED: readonly SplitStatus[] = ["rechecked", "unresolved"];

/** A recheck question's own split, tied to the difference it followed up. */
export interface RecheckResult {
  of: string;
  split: Split;
}

/**
 * True when a difference needs nothing more. A recheck without enough answers leaves the
 * wording confirmed for good, since that wording can't be rechecked again.
 */
export function isSettled(split: Split, rechecks: readonly RecheckResult[]): boolean {
  if (SETTLED.includes(split.status)) return true;
  return (
    split.status === "confirmed" &&
    rechecks.some((r) => r.of === split.id && r.split.outcome === "insufficient")
  );
}

export function organizerRechecks(
  state: Pick<OrganizerMeetingState, "probes" | "splits">,
): RecheckResult[] {
  return state.probes.flatMap((p) => {
    const split = state.splits.find((s) => s.probeId === p.id);
    return p.kind === "recheck" && p.splitId !== null && split ? [{ of: p.splitId, split }] : [];
  });
}

/** Splits found by a diagnostic question: the ones the meeting has to resolve. */
export function splitsToSettle(
  splits: readonly Split[],
  probes: OrganizerMeetingState["probes"],
): Split[] {
  const diagnostic = new Set(probes.filter((p) => p.kind === "diagnostic").map((p) => p.id));
  return splits.filter((s) => s.outcome === "split" && diagnostic.has(s.probeId));
}

/**
 * Where the meeting is, worked out from its rounds and splits rather than its status, which
 * stays `revealed` from the first reveal on.
 */
export function organizerStage(state: OrganizerMeetingState): OrganizerStage {
  const m = state.meeting;
  if (m.source === "audio") {
    if (m.transcriptVersion === 0) return "speakers";
    if (m.status === "review") {
      return speakersMapped(state.segments, state.speakers) ? "review" : "speakers";
    }
  }
  const diagnostic = state.rounds.filter((r) => r.kind === "diagnostic");
  if (diagnostic.length === 0) return "questions";
  if (diagnostic.some((r) => r.closedAt === null)) return "round";
  const toSettle = splitsToSettle(state.splits, state.probes);
  const rechecks = organizerRechecks(state);
  if (toSettle.every((s) => isSettled(s, rechecks))) return "record";
  const recheckOpen = state.rounds.some((r) => r.kind === "recheck" && r.closedAt === null);
  if (recheckOpen || toSettle.some((s) => s.status === "confirmed" && !isSettled(s, rechecks))) {
    return "recheck";
  }
  if (state.resolutions.length > 0 || toSettle.some((s) => s.status !== "open")) return "resolve";
  return "reveal";
}

export type ParticipantStage =
  "not_started" | "answer" | "waiting" | "recheck" | "reveal" | "record";

/** Revealed differences from diagnostic questions, with the recheck results tied to them. */
function participantSplits(state: ParticipantState) {
  const toSettle = state.revealed.filter(
    (r) => r.split.outcome === "split" && r.probe.kind === "diagnostic",
  );
  const rechecks = state.revealed.flatMap((r) =>
    r.probe.splitId === null ? [] : [{ of: r.probe.splitId, split: r.split }],
  );
  return { toSettle, rechecks };
}

/** True when the organizer can still send a recheck for wording already confirmed. */
export function recheckMayFollow(state: ParticipantState): boolean {
  const { toSettle, rechecks } = participantSplits(state);
  return toSettle.some((r) => !isSettled(r.split, rechecks));
}

export function participantStage(state: ParticipantState): ParticipantStage {
  if (state.openProbes.length > 0) {
    const answered = new Set(state.ownAnswers.map((a) => a.probeId));
    const unanswered = state.openProbes.filter((p) => !answered.has(p.id));
    if (unanswered.length === 0) return "waiting";
    return unanswered.some((p) => p.kind === "recheck") ? "recheck" : "answer";
  }
  if (state.revealed.length === 0) return "not_started";
  const { toSettle, rechecks } = participantSplits(state);
  // Confirmed wording needs nothing more from participants: the organizer may skip the
  // recheck, and if one is sent it arrives as a new question.
  return toSettle.every((r) => r.split.status === "confirmed" || isSettled(r.split, rechecks))
    ? "record"
    : "reveal";
}
