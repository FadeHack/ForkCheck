import type { Answer, Meeting, Participant, Probe, Round, Split } from "@forkcheck/core";
import type { OrganizerMeetingState, ParticipantState } from "../../src/contracts/api";

export const meeting: Meeting = {
  id: "m1",
  title: "Pilot customer check-in",
  source: "paste",
  status: "probing",
  heldAt: "2026-10-26T19:00:00.000Z",
  timezone: "America/New_York",
  transcriptVersion: 1,
  error: null,
  createdAt: "2026-10-27T20:00:00.000Z",
  deleteAfter: null,
};

export const participants: Participant[] = ["Priya", "Marco", "Dana"].map((name, i) => ({
  id: `p${i}`,
  meetingId: "m1",
  displayName: name,
  isSimulated: false,
  status: "active",
}));

export function probe(id: string, overrides: Partial<Probe> = {}): Probe {
  return {
    id,
    meetingId: "m1",
    kind: "diagnostic",
    candidateId: "c1",
    splitId: null,
    tier: "template",
    stem: `Question ${id}`,
    options: [
      { id: `${id}-a`, text: "Staging" },
      { id: `${id}-b`, text: "Production" },
    ],
    lint: [],
    promptVersion: "probes.v1",
    status: "published",
    ...overrides,
  };
}

export function round(id: string, overrides: Partial<Round> = {}): Round {
  return {
    id,
    meetingId: "m1",
    kind: "diagnostic",
    openedAt: "2026-10-27T20:00:00.000Z",
    closedAt: null,
    closeReason: null,
    ...overrides,
  };
}

export function split(id: string, probeId: string, overrides: Partial<Split> = {}): Split {
  return { id, probeId, outcome: "split", validity: [], status: "open", ...overrides };
}

export function answer(participantId: string, probeId: string, optionId: string | null): Answer {
  return {
    id: `${participantId}-${probeId}`,
    probeId,
    participantId,
    choice: optionId === null ? "unsure" : "option",
    optionId,
    writeInText: null,
    mappedOptionId: null,
    mappedByModel: false,
    simulated: false,
  };
}

export function organizerState(
  overrides: Partial<OrganizerMeetingState> = {},
): OrganizerMeetingState {
  return {
    meeting,
    participants,
    segments: [],
    decisions: [],
    candidates: [],
    probes: [],
    rounds: [],
    answerCounts: [],
    revealedAnswers: [],
    audio: null,
    speakers: [],
    edits: [],
    splits: [],
    resolutions: [],
    confirmations: [],
    replayed: { model: false, transcription: false },
    ...overrides,
  };
}

export function participantState(overrides: Partial<ParticipantState> = {}): ParticipantState {
  return {
    participant: participants[0]!,
    participants,
    meeting: { id: "m1", title: meeting.title, status: meeting.status },
    openProbes: [],
    ownAnswers: [],
    waitingOn: [],
    replayed: { model: false, transcription: false },
    revealed: [],
    ...overrides,
  };
}
