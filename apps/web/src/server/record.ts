import { buildRecord, validateRecord, type Meeting, type RecordInput } from "@forkcheck/core";
import { meetingReplays } from "@forkcheck/db";
import type { RecordResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { revealedSplits } from "./rounds";

/**
 * The meeting's record, built in code from what is stored now and validated on every read.
 * Only diagnostic questions that split become record splits; a recheck's outcome is already
 * in its original split's state. Failing items stay in the record and the report names them.
 */
export async function meetingRecord(
  deps: Deps,
  meeting: Meeting,
  reader: "organizer" | "participant",
): Promise<RecordResponse> {
  const [participants, segments, analysis, probes, stored, audio, replayed] = await Promise.all([
    deps.meetings.participants(meeting.id),
    deps.meetings.segments(meeting.id),
    deps.meetings.analysis(meeting.id),
    deps.meetings.probes(meeting.id),
    deps.splits.list(meeting.id),
    deps.meetings.liveAudio(meeting.id),
    meetingReplays(deps.db, meeting.id),
  ]);
  const splits: RecordInput["splits"] = [];
  // Probes come in rank order, so record splits follow the order the questions were ranked.
  for (const { probe } of probes) {
    const split = stored.find((s) => s.probeId === probe.id);
    const candidate = analysis.candidates.find((c) => c.id === probe.candidateId);
    if (probe.kind !== "diagnostic" || split?.outcome !== "split" || candidate === undefined) {
      continue;
    }
    splits.push({
      decisionId: candidate.decisionId,
      dimension: candidate.dimension,
      state: (await deps.splits.state(split.id))!,
      deadline: null,
    });
  }
  const input: RecordInput = {
    meeting: { id: meeting.id, title: meeting.title, heldAt: meeting.heldAt },
    generatedAt: deps.now().toISOString(),
    participants,
    segments,
    decisions: analysis.decisions,
    splits,
  };
  const record = buildRecord(input);
  const quoted = new Set(
    record.items.flatMap((i) =>
      i.sourceRefs.flatMap((r) => (r.kind === "segment" ? [r.segmentId] : [])),
    ),
  );
  const sources = segments
    .filter((s) => quoted.has(s.id))
    .map(({ id, participantId, startMs, endMs, origin, edited, text }) => ({
      id,
      participantId,
      startMs,
      endMs,
      origin,
      edited,
      text,
    }));
  return {
    record,
    validation: validateRecord(record, input),
    sources,
    questions: await revealedSplits(deps, meeting.id),
    // The recording is served to the organizer only, and only if kept past review.
    playback: reader === "organizer" && audio?.retain === true,
    replayed,
  };
}
