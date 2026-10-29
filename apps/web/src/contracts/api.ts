/**
 * Request and response DTOs for every R§5.3 route. Requests are Zod schemas, parsed by the
 * route handlers; responses are types built from the core model.
 */
import { z } from "zod";
import {
  answerChoice,
  instant,
  participant as participantSchema,
  timezone,
  validityLabel,
  type Answer,
  type Candidate,
  type Confirmation,
  type DecisionRecord,
  type Meeting,
  type Participant,
  type Probe,
  type ProbeOption,
  type RecordValidation,
  type Resolution,
  type Round,
  type Segment,
  type Split,
} from "@forkcheck/core";
import type { DecisionWithEvidence } from "@forkcheck/engine";

const id = z.string().min(1);

export interface ApiError {
  error: { code: string; message: string };
}

// POST /api/meetings
export const createMeetingRequest = z.strictObject({
  title: z.string().trim().min(1),
  heldAt: instant,
  timezone,
  participants: z.array(z.string().trim().min(1)).min(2),
  /** `Name: text` per line, optional `[mm:ss]`. Omitted for audio meetings. */
  transcript: z.string().min(1).optional(),
});
export type CreateMeetingRequest = z.infer<typeof createMeetingRequest>;
export interface CreateMeetingResponse {
  meetingId: string;
  /** Returned once; only its hash is stored. */
  organizerToken: string;
  participantLinks: { participantId: string; displayName: string; token: string; url: string }[];
}

// PATCH /api/meetings/:id/participants/:pid
export const updateParticipantRequest = participantSchema.pick({ status: true });
export type UpdateParticipantRequest = z.infer<typeof updateParticipantRequest>;
export type UpdateParticipantResponse = Participant;

// POST /api/meetings/:id/audio → 202
export const startTranscriptionRequest = z.strictObject({
  storageKey: z.string().min(1),
  keywords: z.array(z.string().min(1)).optional(),
});
export type StartTranscriptionRequest = z.infer<typeof startTranscriptionRequest>;
export interface StartTranscriptionResponse {
  status: "transcribing";
}

// GET /api/meetings/:id
export interface ProbeAnswerCount {
  probeId: string;
  answered: number;
  active: number;
}
/** Answers stay sealed until their round closes: open rounds expose counts only. */
export interface OrganizerMeetingState {
  meeting: Meeting;
  participants: Participant[];
  segments: Segment[];
  decisions: DecisionWithEvidence[];
  candidates: Candidate[];
  probes: Probe[];
  rounds: Round[];
  answerCounts: ProbeAnswerCount[];
  revealedAnswers: Answer[];
  splits: Split[];
  resolutions: Resolution[];
  confirmations: Confirmation[];
}

// PUT /api/meetings/:id/speakers (many labels may map to one participant)
export const mapSpeakersRequest = z.strictObject({
  mapping: z.record(z.string().min(1), id.nullable()),
});
export type MapSpeakersRequest = z.infer<typeof mapSpeakersRequest>;
export interface MapSpeakersResponse {
  segments: Segment[];
}

// PATCH /api/segments/:id (logged to segment_edit)
export const editSegmentRequest = z
  .strictObject({ text: z.string().optional(), participantId: id.nullable().optional() })
  .refine((b) => b.text !== undefined || b.participantId !== undefined, {
    message: "send text or participantId",
  });
export type EditSegmentRequest = z.infer<typeof editSegmentRequest>;
export type EditSegmentResponse = Segment;

// POST /api/meetings/:id/analyze (idempotent per transcript version)
export interface AnalyzeResponse {
  decisions: DecisionWithEvidence[];
  candidates: Candidate[];
  draftProbes: Probe[];
}

// POST /api/meetings/:id/rounds
export const openRoundRequest = z.strictObject({ probeIds: z.array(id).min(1) });
export type OpenRoundRequest = z.infer<typeof openRoundRequest>;
export interface OpenRoundResponse {
  roundId: string;
}

// PATCH /api/probes/:id → the probe, re-linted after an edit
/**
 * Edits apply to drafts only. `withdrawn: true` removes a draft, or a question from a round
 * that is still open; `false` restores a withdrawn draft that was never published.
 */
export const editProbeRequest = z
  .strictObject({
    stem: z.string().trim().min(1).optional(),
    /** Option texts in order; IDs are reassigned. Count and length are lint findings. */
    options: z.array(z.string().trim().min(1)).optional(),
    withdrawn: z.boolean().optional(),
  })
  .refine((b) => b.stem !== undefined || b.options !== undefined || b.withdrawn !== undefined, {
    message: "send stem, options or withdrawn",
  });
export type EditProbeRequest = z.infer<typeof editProbeRequest>;
export type EditProbeResponse = Probe;

// GET /api/p/:token
/** A probe as a participant sees it: options in their own shuffled order, no lint or tier. */
export interface ParticipantProbe {
  id: string;
  kind: Probe["kind"];
  stem: string;
  options: ProbeOption[];
}
export interface RevealedSplit {
  split: Split;
  probe: ParticipantProbe;
  answers: Answer[];
  resolutions: Resolution[];
  confirmations: Confirmation[];
}
/** Never includes other participants' answers before their round closes. */
export interface ParticipantState {
  participant: Participant;
  meeting: Pick<Meeting, "id" | "title" | "status">;
  openProbes: ParticipantProbe[];
  ownAnswers: Answer[];
  /** Closed rounds only. */
  revealed: RevealedSplit[];
}

// POST /api/p/:token/answers
export const submitAnswerRequest = z
  .strictObject({
    probeId: id,
    choice: answerChoice,
    optionId: id.optional(),
    writeIn: z.string().trim().min(1).optional(),
  })
  .refine((b) => (b.choice === "option") === (b.optionId !== undefined), {
    message: "optionId is required exactly when choice is option",
  })
  .refine((b) => (b.choice === "write_in") === (b.writeIn !== undefined), {
    message: "writeIn is required exactly when choice is write_in",
  });
export type SubmitAnswerRequest = z.infer<typeof submitAnswerRequest>;
export type SubmitAnswerResponse = Answer;

// POST /api/rounds/:id/close
export interface CloseRoundResponse {
  round: Round;
  splits: RevealedSplit[];
}

// POST /api/p/:token/validity
export const labelValidityRequest = z.strictObject({ splitId: id, label: validityLabel });
export type LabelValidityRequest = z.infer<typeof labelValidityRequest>;
export type LabelValidityResponse = Split;

// POST /api/p/:token/resolutions[?draft=1]
export const proposeResolutionRequest = z.strictObject({
  splitId: id,
  text: z.string().trim().min(1),
});
export type ProposeResolutionRequest = z.infer<typeof proposeResolutionRequest>;
export type ProposeResolutionResponse = Resolution;
/** `?draft=1`: nothing is saved; the participant must submit the text themselves. */
export const draftResolutionRequest = z.strictObject({ splitId: id });
export type DraftResolutionRequest = z.infer<typeof draftResolutionRequest>;
export interface DraftResolutionResponse {
  text: string;
  draftedByModel: true;
}

// POST /api/p/:token/resolutions/:rid/confirm (idempotent)
export interface ConfirmResolutionResponse {
  resolution: Resolution;
  confirmedBy: string[];
  pending: string[];
  /** Participants marked absent: not waited for, and named so everyone can see who. */
  absent: string[];
}

// POST /api/p/:token/splits/:id/unresolved → the split, marked "agree to disagree"; no body
export type MarkUnresolvedResponse = Split;

// POST /api/splits/:id/recheck (only after confirmed)
export interface StartRecheckResponse {
  roundId: string;
  probe: Probe;
}

// GET /api/meetings/:id/record
export interface RecordResponse {
  record: DecisionRecord;
  validation: RecordValidation;
}

// DELETE /api/meetings/:id → 204, no body
