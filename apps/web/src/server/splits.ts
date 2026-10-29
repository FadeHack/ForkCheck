import type { Participant } from "@forkcheck/core";
import type { LabelValidityRequest, LabelValidityResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { apiError, json, notFound } from "./http";

/**
 * Sets the participant's label on a revealed split of their meeting. Each participant has one
 * label per split and can change it until someone proposes a resolution.
 */
export async function labelValidity(
  deps: Deps,
  participant: Participant,
  body: LabelValidityRequest,
): Promise<Response> {
  const split = await deps.splits.get(body.splitId);
  const found = split && (await deps.rounds.getProbe(split.probeId));
  if (!split || !found || found.probe.meetingId !== participant.meetingId) {
    return notFound("Question");
  }
  const saved = await deps.splits.labelIfOpen(split.id, participant.id, body.label);
  if (saved === null) {
    return apiError(
      409,
      "resolution_started",
      "Someone has proposed a resolution, so labels on this question can't change now.",
    );
  }
  const response: LabelValidityResponse = saved;
  return json(response);
}
