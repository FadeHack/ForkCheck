import { randomUUID } from "node:crypto";
import { parseTranscript, type Meeting, type Participant } from "@forkcheck/core";
import type {
  CreateMeetingRequest,
  CreateMeetingResponse,
  OrganizerMeetingState,
  ProbeAnswerCount,
} from "../contracts/api";
import type { Deps } from "./deps";
import { hashToken, newToken } from "./tokens";

export async function createMeeting(
  deps: Deps,
  body: CreateMeetingRequest,
  origin: string,
): Promise<CreateMeetingResponse> {
  const id = randomUUID();
  const meeting: Meeting = {
    id,
    title: body.title,
    source: body.transcript === undefined ? "audio" : "paste",
    status: "draft",
    heldAt: new Date(body.heldAt).toISOString(),
    timezone: body.timezone,
    transcriptVersion: body.transcript === undefined ? 0 : 1,
    error: null,
    createdAt: deps.now().toISOString(),
    deleteAfter: null,
  };
  const participants = body.participants.map((p, i) => ({
    participant: {
      id: `${id}:p:${i}`,
      meetingId: id,
      displayName: typeof p === "string" ? p : p.name,
      isSimulated: typeof p !== "string",
      status: "active",
    } satisfies Participant,
    simulatorNotes: typeof p === "string" ? undefined : p.notes,
    token: newToken(),
  }));
  const segments =
    body.transcript === undefined
      ? []
      : parseTranscript({
          meetingId: id,
          text: body.transcript,
          participants: participants.map((p) => p.participant),
        }).segments;

  const organizerToken = newToken();
  await deps.meetings.create({
    meeting,
    organizerTokenHash: hashToken(organizerToken),
    participants: participants.map((p) => ({
      participant: p.participant,
      tokenHash: hashToken(p.token),
      simulatorNotes: p.simulatorNotes,
    })),
    segments,
  });

  return {
    meetingId: id,
    organizerToken,
    participantLinks: participants.map(({ participant, token }) => ({
      participantId: participant.id,
      displayName: participant.displayName,
      token,
      url: new URL(`/p/${token}`, origin).toString(),
    })),
  };
}

/** Answers stay sealed until their split is saved, for the organizer too: only counts are returned. */
export async function organizerState(deps: Deps, meeting: Meeting): Promise<OrganizerMeetingState> {
  const [participants, segments, analysis, probes, rounds, splits] = await Promise.all([
    deps.meetings.participants(meeting.id),
    deps.meetings.segments(meeting.id),
    deps.meetings.analysis(meeting.id),
    deps.meetings.probes(meeting.id),
    deps.rounds.list(meeting.id),
    deps.splits.list(meeting.id),
  ]);
  // A question's answers are revealed once its split exists, not when its round closes:
  // write-ins are still being matched in between.
  const published = probes.filter((p) => p.roundId !== null);
  const answers = await deps.rounds.answers(published.map((p) => p.probe.id));
  const revealedProbes = new Set(splits.map((s) => s.probeId));
  const active = participants.filter((p) => p.status === "active").length;
  const answerCounts: ProbeAnswerCount[] = published
    .filter((p) => p.probe.status !== "withdrawn" && !revealedProbes.has(p.probe.id))
    .map(({ probe }) => {
      const answeredBy = answers.filter((a) => a.probeId === probe.id).map((a) => a.participantId);
      return { probeId: probe.id, answered: answeredBy.length, active, answeredBy };
    });
  const resolutions = await deps.splits.resolutions(splits.map((s) => s.id));
  const confirmations = await deps.splits.confirmations(resolutions.map((r) => r.id));
  const [audio, speakers, edits] = await Promise.all([
    deps.meetings.liveAudio(meeting.id),
    deps.meetings.speakerMap(meeting.id),
    deps.meetings.segmentEdits(meeting.id),
  ]);

  return {
    meeting,
    participants,
    segments,
    decisions: analysis.decisions,
    candidates: analysis.candidates,
    probes: probes.map((p) => p.probe),
    rounds,
    answerCounts,
    revealedAnswers: answers.filter((a) => revealedProbes.has(a.probeId)),
    splits,
    resolutions,
    confirmations,
    audio,
    speakers,
    edits,
  };
}

/** Removes stored audio first, then the meeting; rows cascade. */
export async function deleteMeeting(deps: Deps, meetingId: string): Promise<void> {
  for (const key of await deps.meetings.audioKeys(meetingId)) await deps.storage.delete(key);
  await deps.meetings.delete(meetingId);
}
