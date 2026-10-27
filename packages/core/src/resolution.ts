import type { Participant } from "./model/meeting";
import type { Confirmation, Resolution, SplitStatus } from "./model/probe";
import type { RecordItem } from "./model/record";
import type { DivergenceOutcome } from "./divergence";

export interface ResolutionState {
  splitId: string;
  status: SplitStatus;
  participants: Pick<Participant, "id" | "status">[];
  /** Every resolution ever proposed for the split, oldest first. */
  resolutions: Resolution[];
  /** Confirmations of the current resolution only; a new proposal clears them. */
  confirmations: Confirmation[];
  /** Set when the last recheck was insufficient: the split stays confirmed, not verified. */
  recheckInconclusive: boolean;
}

/** Only participants act. A model can draft text, but a participant has to submit it. */
export type Actor = { kind: "participant"; participantId: string } | { kind: "model" };

export type ResolutionEvent =
  | {
      type: "propose";
      actor: Actor;
      resolutionId: string;
      text: string;
      /** The participant is submitting text a model drafted. */
      draftedByModel: boolean;
    }
  | { type: "confirm"; actor: Actor; at: string }
  | { type: "agree_to_disagree"; actor: Actor }
  | { type: "recheck"; outcome: DivergenceOutcome }
  | { type: "set_participant_status"; participantId: string; status: "active" | "absent" };

export type ResolutionErrorCode =
  | "invalid_transition"
  | "model_cannot_act"
  | "unknown_participant"
  | "participant_absent"
  | "empty_text"
  | "duplicate_resolution_id"
  | "no_proposal"
  | "already_confirmed"
  | "would_break_confirmation";

export interface ResolutionError {
  code: ResolutionErrorCode;
  message: string;
}

export type TransitionResult =
  { ok: true; state: ResolutionState } | { ok: false; error: ResolutionError };

export function initialResolutionState(
  splitId: string,
  participants: Pick<Participant, "id" | "status">[],
): ResolutionState {
  return {
    splitId,
    status: "open",
    participants: participants.map(({ id, status }) => ({ id, status })),
    resolutions: [],
    confirmations: [],
    recheckInconclusive: false,
  };
}

const fail = (code: ResolutionErrorCode, message: string): TransitionResult => ({
  ok: false,
  error: { code, message },
});

const activeIds = (s: ResolutionState) =>
  s.participants.filter((p) => p.status === "active").map((p) => p.id);

export const currentResolution = (s: ResolutionState) =>
  s.resolutions.find((r) => r.status === "proposed" || r.status === "confirmed");

/** True when every active participant has confirmed the current resolution. */
export function everyoneConfirmed(s: ResolutionState): boolean {
  const current = currentResolution(s);
  const active = activeIds(s);
  if (!current || active.length === 0) return false;
  const confirmed = new Set(
    s.confirmations.filter((c) => c.resolutionId === current.id).map((c) => c.participantId),
  );
  return active.every((id) => confirmed.has(id));
}

/** Moves a resolving split to confirmed once the last active participant has confirmed. */
function settle(s: ResolutionState): ResolutionState {
  if (s.status !== "resolving" || !everyoneConfirmed(s)) return s;
  const current = currentResolution(s)!;
  return {
    ...s,
    status: "confirmed",
    recheckInconclusive: false,
    resolutions: s.resolutions.map((r) =>
      r.id === current.id ? { ...r, status: "confirmed" } : r,
    ),
  };
}

function actingParticipant(
  s: ResolutionState,
  actor: Actor,
): { ok: true; id: string } | { ok: false; result: TransitionResult } {
  if (actor.kind !== "participant") {
    return { ok: false, result: fail("model_cannot_act", "only a participant can do this") };
  }
  const p = s.participants.find((x) => x.id === actor.participantId);
  if (!p) {
    return {
      ok: false,
      result: fail("unknown_participant", `${actor.participantId} is not in this meeting`),
    };
  }
  if (p.status !== "active") {
    return { ok: false, result: fail("participant_absent", `${p.id} is marked absent`) };
  }
  return { ok: true, id: p.id };
}

/**
 * R§5.5 recheck outcomes: the split's next status and the record's recheck value. An
 * insufficient recheck leaves the split confirmed, marked not conclusive.
 */
export const RECHECK_OUTCOMES = {
  consistent: { status: "rechecked", record: "passed" },
  split: { status: "reopened", record: "failed" },
  insufficient: { status: "confirmed", record: "not_conclusive" },
} as const satisfies Record<
  DivergenceOutcome,
  { status: SplitStatus; record: RecordItem["recheck"] }
>;

const OPEN_FOR_PROPOSALS: readonly SplitStatus[] = ["open", "resolving", "reopened"];

/**
 * Split: open → resolving → confirmed → rechecked | reopened, and unresolved for
 * "agree to disagree". Resolution: proposed → confirmed | superseded. Every transition
 * not listed here returns a typed error and leaves the state as it was.
 */
export function applyResolutionEvent(s: ResolutionState, e: ResolutionEvent): TransitionResult {
  switch (e.type) {
    case "propose": {
      if (!OPEN_FOR_PROPOSALS.includes(s.status)) {
        return fail("invalid_transition", `cannot propose while the split is ${s.status}`);
      }
      const actor = actingParticipant(s, e.actor);
      if (!actor.ok) return actor.result;
      const text = e.text.trim();
      if (text === "") return fail("empty_text", "a resolution needs text");
      if (s.resolutions.some((r) => r.id === e.resolutionId)) {
        return fail("duplicate_resolution_id", `resolution ${e.resolutionId} already exists`);
      }
      const proposed: Resolution = {
        id: e.resolutionId,
        splitId: s.splitId,
        text,
        proposedBy: actor.id,
        draftedByModel: e.draftedByModel,
        status: "proposed",
      };
      return {
        ok: true,
        state: {
          ...s,
          status: "resolving",
          resolutions: [
            ...s.resolutions.map((r): Resolution =>
              r.status === "superseded" ? r : { ...r, status: "superseded" },
            ),
            proposed,
          ],
          confirmations: [],
          recheckInconclusive: false,
        },
      };
    }

    case "confirm": {
      if (s.status !== "resolving") {
        return fail("invalid_transition", `cannot confirm while the split is ${s.status}`);
      }
      const actor = actingParticipant(s, e.actor);
      if (!actor.ok) return actor.result;
      const current = currentResolution(s);
      if (!current) return fail("no_proposal", "there is no proposal to confirm");
      if (s.confirmations.some((c) => c.participantId === actor.id)) {
        return fail("already_confirmed", `${actor.id} already confirmed this proposal`);
      }
      const confirmation: Confirmation = {
        resolutionId: current.id,
        participantId: actor.id,
        at: e.at,
      };
      return {
        ok: true,
        state: settle({ ...s, confirmations: [...s.confirmations, confirmation] }),
      };
    }

    case "agree_to_disagree": {
      if (!OPEN_FOR_PROPOSALS.includes(s.status)) {
        return fail("invalid_transition", `cannot mark unresolved while the split is ${s.status}`);
      }
      const actor = actingParticipant(s, e.actor);
      if (!actor.ok) return actor.result;
      return {
        ok: true,
        state: {
          ...s,
          status: "unresolved",
          resolutions: s.resolutions.map((r): Resolution =>
            r.status === "superseded" ? r : { ...r, status: "superseded" },
          ),
          confirmations: [],
        },
      };
    }

    case "recheck": {
      if (s.status !== "confirmed") {
        return fail("invalid_transition", `cannot recheck while the split is ${s.status}`);
      }
      const { status } = RECHECK_OUTCOMES[e.outcome];
      return {
        ok: true,
        state: { ...s, status, recheckInconclusive: e.outcome === "insufficient" },
      };
    }

    case "set_participant_status": {
      const p = s.participants.find((x) => x.id === e.participantId);
      if (!p) return fail("unknown_participant", `${e.participantId} is not in this meeting`);
      const next: ResolutionState = {
        ...s,
        participants: s.participants.map((x) => (x.id === p.id ? { ...x, status: e.status } : x)),
      };
      if (s.status === "confirmed" && !everyoneConfirmed(next)) {
        return fail(
          "would_break_confirmation",
          `${p.id} has not confirmed; reopen the split before marking them active`,
        );
      }
      return { ok: true, state: settle(next) };
    }
  }
}
