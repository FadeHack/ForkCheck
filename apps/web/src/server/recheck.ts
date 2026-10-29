import { currentResolution, type Meeting, type Round } from "@forkcheck/core";
import { vetRecheck } from "@forkcheck/engine";
import type { StartRecheckResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { apiError, json, notFound } from "./http";
import { logError } from "./log";

/**
 * Opens a recheck round for a confirmed split: one new question about a consequence of the
 * resolution, so the group can see whether they now read it the same way. Closing the round
 * applies the outcome to the split.
 */
export async function startRecheck(
  deps: Deps,
  meeting: Meeting,
  splitId: string,
): Promise<Response> {
  const split = await deps.splits.get(splitId);
  const found = split && (await deps.rounds.getProbe(split.probeId));
  if (!split || !found || found.probe.meetingId !== meeting.id) return notFound("Question");
  const original = found.probe;
  if (original.kind === "recheck") {
    return apiError(
      409,
      "recheck_question",
      "This question is itself a recheck. Recheck the original question instead.",
    );
  }
  const state = (await deps.splits.state(split.id))!;
  const resolution = currentResolution(state);
  if (state.status !== "confirmed" || resolution === undefined) {
    return apiError(
      409,
      "not_confirmed",
      "A question can be rechecked once everyone present has confirmed its resolution.",
    );
  }
  if ((await deps.rounds.getProbe(`${split.id}:recheck:${resolution.id}`)) !== null) {
    return apiError(409, "already_rechecked", "This resolution has already been rechecked.");
  }
  if ((await deps.rounds.openRound(meeting.id)) !== null) {
    return apiError(409, "round_open", "A round is already open. Close it before sending more.");
  }

  const [analysis, segments] = await Promise.all([
    deps.meetings.analysis(meeting.id),
    deps.meetings.segments(meeting.id),
  ]);
  const candidate = analysis.candidates.find((c) => c.id === original.candidateId);
  const decision = analysis.decisions.find((d) => d.decision.id === candidate?.decisionId);
  if (decision === undefined) {
    return apiError(
      409,
      "no_decision",
      "This question isn't linked to an item, so there is nothing to recheck.",
    );
  }

  let vetted;
  try {
    vetted = await vetRecheck(
      { decision, originalProbe: original, resolution, segments },
      deps.model(meeting.id),
    );
  } catch (error) {
    logError(`recheck ${split.id}`, error);
    return apiError(
      502,
      "recheck_failed",
      "Writing the recheck question didn't finish. Try again.",
    );
  }
  if (vetted.probe === null) {
    return apiError(
      409,
      "recheck_failed",
      "Two attempts at a recheck question both failed the checks, so none was sent.",
    );
  }

  const round: Round = {
    id: `${meeting.id}:round:${(await deps.rounds.list(meeting.id)).length}`,
    meetingId: meeting.id,
    kind: "recheck",
    openedAt: deps.now().toISOString(),
    closedAt: null,
    closeReason: null,
  };
  if (!(await deps.rounds.open(round, [], [vetted.probe]))) {
    return apiError(409, "round_open", "A round is already open. Close it before sending more.");
  }
  const response: StartRecheckResponse = {
    roundId: round.id,
    probe: { ...vetted.probe, status: "published" },
  };
  return json(response, 201);
}
