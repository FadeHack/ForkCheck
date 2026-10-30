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
  type MeetingStatus,
  type Participant,
  type Probe,
  type ProbeOption,
  type RecordValidation,
  type Resolution,
  type Round,
  type Segment,
  type SourceQuote,
  type Split,
} from "@forkcheck/core";
import type { DecisionWithEvidence } from "@forkcheck/engine";

const id = z.string().min(1);

export interface ApiError {
  error: { code: string; message: string };
}

// POST /api/meetings
const displayName = z.string().trim().min(1);
/**
 * A name, or a simulated participant: the simulator answers for them from these private
 * notes, and every answer it gives is labeled SIMULATED. The notes are never returned.
 */
export const newParticipant = z.union([
  displayName,
  z.strictObject({
    name: displayName,
    simulated: z.literal(true),
    notes: z.string().trim().min(1),
  }),
]);
export const createMeetingRequest = z.strictObject({
  title: z.string().trim().min(1),
  heldAt: instant,
  timezone,
  participants: z.array(newParticipant).min(2),
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

// POST /api/meetings/:id/audio/upload → 201; the body is the file's raw bytes
export interface UploadAudioResponse {
  /** Passed back in `POST /api/meetings/:id/audio`. */
  storageKey: string;
  bytes: number;
}

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
  /** Who has answered, by participant ID: never what they chose. */
  answeredBy: string[];
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
  /** The meeting's recording while it is stored; a new upload replaces it. */
  audio: StoredAudio | null;
}

export interface StoredAudio {
  storageKey: string;
  /** Known once transcribed. */
  durationMs: number | null;
  /** Kept after review, so quotes can link to playback. */
  retain: boolean;
}

// POST /api/meetings/:id/simulate → answers the open round for simulated participants; no body
/** A count only: the answers stay sealed until the round closes, as for any participant. */
export interface SimulateAnswersResponse {
  submitted: number;
}

// GET /api/meetings/:id/progress, polled while transcription or analysis runs
export interface MeetingProgressResponse {
  status: MeetingStatus;
  /** The step running now, or the one that failed; null when nothing is running. */
  step: "transcribe" | "extract" | "candidates" | "probes" | null;
  /** The running step has shown no sign of life for 10 minutes: a retry takes it over. */
  stalled: boolean;
  error: string | null;
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
  /** For a recheck question, the difference it follows up; null otherwise. */
  splitId: string | null;
  stem: string;
  options: ProbeOption[];
}
export interface RevealedSplit {
  split: Split;
  probe: ParticipantProbe;
  /** What was said about the decision, so every viewer starts from the same words. */
  quote: SourceQuote | null;
  answers: Answer[];
  resolutions: Resolution[];
  confirmations: Confirmation[];
}
/** Never includes other participants' answers before their round closes. */
export interface ParticipantState {
  participant: Participant;
  /** Everyone in the meeting, the viewer included, so a reveal names who chose what. */
  participants: Participant[];
  meeting: Pick<Meeting, "id" | "title" | "status">;
  openProbes: ParticipantProbe[];
  ownAnswers: Answer[];
  /**
   * Display names of the other active participants who haven't answered every open question.
   * Alphabetical. Names only: never which questions or what they chose. Empty when no round
   * is open.
   */
  waitingOn: string[];
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
  /** The participant is submitting a model draft, edited or not. Omitted means their own words. */
  draftedByModel: z.boolean().optional(),
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

// GET /api/meetings/:id/record, and read-only for participants at GET /api/p/:token/record
export interface RecordResponse {
  record: DecisionRecord;
  validation: RecordValidation;
  /** The transcript segments the record quotes, so each quote links to where it was said. */
  sources: RecordSource[];
  /** Every revealed question with its answers, in rank order: the forks the record links to. */
  questions: RevealedSplit[];
}
export type RecordSource = Pick<
  Segment,
  "id" | "participantId" | "startMs" | "origin" | "edited" | "text"
>;

// GET /api/meetings/:id/trace (organizer only)
/** One logged model call. The log never holds prompts, replies or answers. */
export interface TraceCall {
  at: string;
  stage: string;
  /** `fake` is a replay of a recorded reply: it takes no time and costs nothing. */
  provider: string;
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  costUsd: number;
  ok: boolean;
  error: string | null;
}
export interface TraceResponse {
  calls: TraceCall[];
  /** What code decided, as counts. Null until a round has been revealed. */
  computed: {
    questions: { split: number; consistent: number; insufficient: number };
    confirmations: number;
    record: { confirmed: number; unresolved: number; stated: number };
  } | null;
}

// DELETE /api/meetings/:id → 204, no body
