import {
  applyResolutionEvent,
  currentResolution,
  type Actor,
  type Meeting,
  type Participant,
  type ResolutionError,
  type ResolutionState,
  type Split,
  type SplitStatus,
} from "@forkcheck/core";
import { draftResolution } from "@forkcheck/engine";
import type {
  ConfirmResolutionResponse,
  DraftResolutionRequest,
  DraftResolutionResponse,
  LabelValidityRequest,
  LabelValidityResponse,
  MarkUnresolvedResponse,
  ProposeResolutionRequest,
  ProposeResolutionResponse,
} from "../contracts/api";
import type { Deps } from "./deps";
import { apiError, json, notFound } from "./http";
import { logError } from "./log";

/**
 * The split, if it belongs to this meeting; splits of other meetings look unknown. A
 * recheck's split only shows the recheck answers, so it takes no labels or resolutions.
 */
async function splitIn(
  deps: Deps,
  meetingId: string,
  splitId: string,
): Promise<{ split: Split } | { refused: Response }> {
  const split = await deps.splits.get(splitId);
  const found = split && (await deps.rounds.getProbe(split.probeId));
  if (!split || !found || found.probe.meetingId !== meetingId) {
    return { refused: notFound("Question") };
  }
  if (found.probe.kind === "recheck") {
    return {
      refused: apiError(
        409,
        "recheck_question",
        "This question rechecked a resolution. Discuss it on the original question.",
      ),
    };
  }
  return { split };
}

/**
 * Sets the participant's label on a revealed split of their meeting. Each participant has one
 * label per split and can change it until someone proposes a resolution.
 */
export async function labelValidity(
  deps: Deps,
  participant: Participant,
  body: LabelValidityRequest,
): Promise<Response> {
  const found = await splitIn(deps, participant.meetingId, body.splitId);
  if ("refused" in found) return found.refused;
  const { split } = found;
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

const WHERE_IT_STANDS: Record<SplitStatus, string> = {
  open: "Nobody has proposed a resolution for this question yet.",
  resolving: "A resolution for this question is waiting for confirmations.",
  confirmed: "Everyone has confirmed a resolution for this question.",
  rechecked: "This question's resolution was confirmed and checked again.",
  reopened: "This question was reopened after a recheck.",
  unresolved: "The group agreed to disagree on this question.",
};

/** A refused state-machine step, in words a participant can act on. */
function refused(error: ResolutionError, state: ResolutionState): Response {
  switch (error.code) {
    case "participant_absent":
      return apiError(
        409,
        "participant_absent",
        "You're marked absent from this meeting. Ask the organizer to mark you present first.",
      );
    case "invalid_transition":
    case "no_proposal":
      return apiError(409, "invalid_transition", WHERE_IT_STANDS[state.status]);
    case "would_break_confirmation":
      return apiError(
        409,
        "would_break_confirmation",
        "Everyone else confirmed a resolution while this person was absent. Marking them present would undo that confirmation.",
      );
    default:
      return apiError(409, error.code, error.message);
  }
}

const actor = (participant: Participant): Actor => ({
  kind: "participant",
  participantId: participant.id,
});

/**
 * Saves the participant's own text as the split's resolution. Any earlier proposal is
 * superseded and its confirmations stop counting.
 */
export async function proposeResolution(
  deps: Deps,
  participant: Participant,
  body: ProposeResolutionRequest,
): Promise<Response> {
  const found = await splitIn(deps, participant.meetingId, body.splitId);
  if ("refused" in found) return found.refused;
  const { split } = found;
  let resolutionId = "";
  const done = (await deps.splits.transition(split.id, (s) => {
    resolutionId = `${s.splitId}:res:${s.resolutions.length}`;
    return applyResolutionEvent(s, {
      type: "propose",
      actor: actor(participant),
      resolutionId,
      text: body.text,
      draftedByModel: body.draftedByModel ?? false,
    });
  }))!;
  if (!done.result.ok) return refused(done.result.error, done.before);
  const response: ProposeResolutionResponse = done.result.state.resolutions.find(
    (r) => r.id === resolutionId,
  )!;
  return json(response, 201);
}

const PROPOSALS_OPEN: readonly SplitStatus[] = ["open", "resolving", "reopened"];

/** A model's wording for a resolution. Nothing is saved; the participant decides what to submit. */
export async function draftResolutionFor(
  deps: Deps,
  participant: Participant,
  body: DraftResolutionRequest,
): Promise<Response> {
  const found = await splitIn(deps, participant.meetingId, body.splitId);
  if ("refused" in found) return found.refused;
  const { split } = found;
  if (!PROPOSALS_OPEN.includes(split.status)) {
    return apiError(409, "invalid_transition", WHERE_IT_STANDS[split.status]);
  }
  const { probe } = (await deps.rounds.getProbe(split.probeId))!;
  const analysis = await deps.meetings.analysis(participant.meetingId);
  const candidate = analysis.candidates.find((c) => c.id === probe.candidateId);
  const decision = analysis.decisions.find((d) => d.decision.id === candidate?.decisionId);
  if (decision === undefined) {
    return apiError(
      409,
      "no_decision",
      "This question isn't linked to an item, so there is nothing to draft from.",
    );
  }
  try {
    const { output } = await draftResolution(
      { decision, probe, split, answers: await deps.rounds.answers([probe.id]) },
      deps.model(participant.meetingId),
    );
    const response: DraftResolutionResponse = output;
    return json(response);
  } catch (error) {
    logError(`draft resolution ${split.id}`, error);
    return apiError(502, "draft_failed", "Drafting didn't finish. Try again, or write your own.");
  }
}

/**
 * Confirms the current resolution. Confirming twice changes nothing. The split is confirmed
 * once every active participant has confirmed; absent participants are listed, not waited for.
 */
export async function confirmResolution(
  deps: Deps,
  participant: Participant,
  resolutionId: string,
): Promise<Response> {
  const resolution = await deps.splits.getResolution(resolutionId);
  if (resolution === null) return notFound("Resolution");
  const found = await splitIn(deps, participant.meetingId, resolution.splitId);
  if ("refused" in found) return notFound("Resolution");
  const { split } = found;

  let superseded = false;
  const done = (await deps.splits.transition(split.id, (s) => {
    if (
      s.confirmations.some(
        (c) => c.participantId === participant.id && c.resolutionId === resolutionId,
      )
    ) {
      return { ok: true, state: s };
    }
    if (currentResolution(s)?.id !== resolutionId) {
      superseded = s.resolutions.some((r) => r.id === resolutionId && r.status === "superseded");
    }
    return superseded
      ? { ok: false, error: { code: "invalid_transition", message: "superseded" } }
      : applyResolutionEvent(s, {
          type: "confirm",
          actor: actor(participant),
          at: deps.now().toISOString(),
        });
  }))!;
  if (superseded) {
    return apiError(
      409,
      "resolution_superseded",
      "A newer resolution was proposed for this question. Read it and confirm that one instead.",
    );
  }
  if (!done.result.ok) return refused(done.result.error, done.before);

  const state = done.result.state;
  const confirmedBy = state.confirmations
    .filter((c) => c.resolutionId === resolutionId)
    .map((c) => c.participantId);
  const response: ConfirmResolutionResponse = {
    resolution: state.resolutions.find((r) => r.id === resolutionId)!,
    confirmedBy,
    pending: state.participants
      .filter((p) => p.status === "active" && !confirmedBy.includes(p.id))
      .map((p) => p.id),
    absent: state.participants.filter((p) => p.status === "absent").map((p) => p.id),
  };
  return json(response);
}

/** "Agree to disagree": the split is recorded as unresolved, and open proposals are superseded. */
export async function markUnresolved(
  deps: Deps,
  participant: Participant,
  splitId: string,
): Promise<Response> {
  const found = await splitIn(deps, participant.meetingId, splitId);
  if ("refused" in found) return found.refused;
  const { split } = found;
  const done = (await deps.splits.transition(split.id, (s) =>
    applyResolutionEvent(s, { type: "agree_to_disagree", actor: actor(participant) }),
  ))!;
  if (!done.result.ok) return refused(done.result.error, done.before);
  const response: MarkUnresolvedResponse = (await deps.splits.get(split.id))!;
  return json(response);
}

/** Marks a participant active or absent, applying the change to every split of the meeting. */
export async function setParticipantStatus(
  deps: Deps,
  meeting: Meeting,
  participantId: string,
  status: Participant["status"],
): Promise<Response> {
  const done = await deps.splits.setParticipantStatus(meeting.id, participantId, status);
  if (done === null) return notFound("Participant");
  if (!done.ok) return refused(done.failed.error, done.before);
  return json(done.participant);
}
