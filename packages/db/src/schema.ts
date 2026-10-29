// drizzle-kit reads this file to generate migrations. IDs are text: the engine derives
// child IDs from the meeting ID (`<meeting>:dec:0`), so they are unique across meetings.
import type {
  Impact,
  LintFinding,
  ProbeOption,
  Reading,
  RecordDeadline,
  SourceRef,
  ValidityLabel,
} from "@forkcheck/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const meetingRef = () =>
  text("meeting_id")
    .notNull()
    .references(() => meeting.id, { onDelete: "cascade" });

export const meetingStatus = pgEnum("meeting_status", [
  "draft",
  "transcribing",
  "review",
  "analyzing",
  "probing",
  "revealed",
  "resolving",
  "recorded",
  "failed",
]);
/** Analysis steps in run order; a retry resumes after the last one that finished. */
export const analysisStep = pgEnum("analysis_step", ["extract", "candidates", "probes"]);
export const meetingSource = pgEnum("meeting_source", ["paste", "audio"]);
export const participantStatus = pgEnum("participant_status", ["active", "absent"]);
export const segmentOrigin = pgEnum("segment_origin", ["paste", "asr"]);
export const decisionKind = pgEnum("decision_kind", [
  "decision",
  "commitment",
  "assumption",
  "open_item",
]);
export const decisionStatus = pgEnum("decision_status", [
  "explicit",
  "ambiguous",
  "unresolved",
  "debated",
]);
export const dimension = pgEnum("dimension", [
  "owner",
  "deadline",
  "scope",
  "criteria",
  "dependency",
  "outcome",
]);
export const roundKind = pgEnum("round_kind", ["diagnostic", "recheck"]);
export const probeTier = pgEnum("probe_tier", ["template", "assisted", "free"]);
export const probeStatus = pgEnum("probe_status", ["draft", "published", "withdrawn"]);
export const answerChoice = pgEnum("answer_choice", ["option", "unsure", "write_in"]);
export const closeReason = pgEnum("close_reason", ["all_answered", "organizer_quorum"]);
export const splitOutcome = pgEnum("split_outcome", ["split", "consistent", "insufficient"]);
export const splitStatus = pgEnum("split_status", [
  "open",
  "resolving",
  "confirmed",
  "rechecked",
  "reopened",
  "unresolved",
]);
export const resolutionStatus = pgEnum("resolution_status", [
  "proposed",
  "confirmed",
  "superseded",
]);
export const recordCategory = pgEnum("record_category", ["stated", "confirmed", "unresolved"]);
export const recheckResult = pgEnum("recheck_result", [
  "passed",
  "failed",
  "not_conclusive",
  "not_run",
]);

export const meeting = pgTable("meeting", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  source: meetingSource("source").notNull(),
  status: meetingStatus("status").notNull(),
  heldAt: at("held_at").notNull(),
  timezone: text("timezone").notNull(),
  organizerTokenHash: text("organizer_token_hash").notNull().unique(),
  transcriptVersion: integer("transcript_version").notNull().default(0),
  error: text("error"),
  /** The transcript version the stored analysis belongs to, and how far it got. */
  analysisVersion: integer("analysis_version"),
  analysisStep: analysisStep("analysis_step"),
  failedStep: analysisStep("failed_step"),
  /** The run holding a long step (analysis, later transcription) and its last sign of life. */
  stepRunId: text("step_run_id"),
  stepHeartbeatAt: at("step_heartbeat_at"),
  createdAt: at("created_at").notNull(),
  deleteAfter: at("delete_after"),
});

export const participant = pgTable(
  "participant",
  {
    id: text("id").primaryKey(),
    meetingId: meetingRef(),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    /** What the simulator answers from; private, so never part of the Participant model. */
    simulatorNotes: text("simulator_notes"),
    status: participantStatus("status").notNull().default("active"),
  },
  (t) => [index("participant_meeting_idx").on(t.meetingId)],
);

export const audioAsset = pgTable("audio_asset", {
  id: text("id").primaryKey(),
  meetingId: meetingRef(),
  storageKey: text("storage_key").notNull(),
  durationMs: integer("duration_ms"),
  retain: boolean("retain").notNull().default(false),
  deletedAt: at("deleted_at"),
});

export const segment = pgTable(
  "segment",
  {
    id: text("id").primaryKey(),
    meetingId: meetingRef(),
    idx: integer("idx").notNull(),
    speakerLabel: text("speaker_label"),
    participantId: text("participant_id").references(() => participant.id, {
      onDelete: "set null",
    }),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    text: text("text").notNull(),
    origin: segmentOrigin("origin").notNull(),
    edited: boolean("edited").notNull().default(false),
  },
  (t) => [unique("segment_meeting_idx_unique").on(t.meetingId, t.idx)],
);

export const segmentEdit = pgTable("segment_edit", {
  id: text("id").primaryKey(),
  segmentId: text("segment_id")
    .notNull()
    .references(() => segment.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  before: text("before"),
  after: text("after"),
  editedBy: text("edited_by").notNull(),
  at: at("at").notNull(),
});

export const decision = pgTable(
  "decision",
  {
    id: text("id").primaryKey(),
    meetingId: meetingRef(),
    idx: integer("idx").notNull(),
    kind: decisionKind("kind").notNull(),
    statement: text("statement").notNull(),
    ownerText: text("owner_text"),
    deadlineText: text("deadline_text"),
    ownerInferred: boolean("owner_inferred").notNull(),
    deadlineInferred: boolean("deadline_inferred").notNull(),
    status: decisionStatus("status").notNull(),
  },
  (t) => [index("decision_meeting_idx").on(t.meetingId)],
);

export const candidate = pgTable("candidate", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id")
    .notNull()
    .references(() => decision.id, { onDelete: "cascade" }),
  dimension: dimension("dimension").notNull(),
  readings: jsonb("readings").$type<Reading[]>().notNull(),
  impact: jsonb("impact").$type<Impact>().notNull(),
});

export const round = pgTable(
  "round",
  {
    id: text("id").primaryKey(),
    meetingId: meetingRef(),
    kind: roundKind("kind").notNull(),
    openedAt: at("opened_at").notNull(),
    closedAt: at("closed_at"),
    closeReason: closeReason("close_reason"),
  },
  (t) => [index("round_meeting_idx").on(t.meetingId)],
);

export const probe = pgTable(
  "probe",
  {
    id: text("id").primaryKey(),
    meetingId: meetingRef(),
    kind: roundKind("kind").notNull(),
    candidateId: text("candidate_id").references(() => candidate.id, { onDelete: "cascade" }),
    splitId: text("split_id").references((): AnyPgColumn => split.id, { onDelete: "cascade" }),
    /** Set when the probe is published in a round. */
    roundId: text("round_id").references(() => round.id, { onDelete: "set null" }),
    tier: probeTier("tier").notNull(),
    stem: text("stem").notNull(),
    options: jsonb("options").$type<ProbeOption[]>().notNull(),
    lint: jsonb("lint").$type<LintFinding[]>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: probeStatus("status").notNull(),
    /** Draft order from analysis, highest impact first; null for recheck probes. */
    rank: integer("rank"),
  },
  (t) => [index("probe_meeting_idx").on(t.meetingId), index("probe_round_idx").on(t.roundId)],
);

export const answer = pgTable(
  "answer",
  {
    id: text("id").primaryKey(),
    probeId: text("probe_id")
      .notNull()
      .references(() => probe.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    choice: answerChoice("choice").notNull(),
    optionId: text("option_id"),
    writeInText: text("write_in_text"),
    mappedOptionId: text("mapped_option_id"),
    mappedByModel: boolean("mapped_by_model").notNull().default(false),
    simulated: boolean("simulated").notNull().default(false),
  },
  (t) => [
    unique("answer_probe_participant_unique").on(t.probeId, t.participantId),
    check(
      "answer_choice_fields",
      sql`(${t.choice} = 'option') = (${t.optionId} is not null) and (${t.choice} = 'write_in') = (${t.writeInText} is not null)`,
    ),
  ],
);

export const split = pgTable("split", {
  id: text("id").primaryKey(),
  probeId: text("probe_id")
    .notNull()
    .unique()
    .references((): AnyPgColumn => probe.id, { onDelete: "cascade" }),
  outcome: splitOutcome("outcome").notNull(),
  validity: jsonb("validity")
    .$type<{ participantId: string; label: ValidityLabel }[]>()
    .notNull()
    .default([]),
  status: splitStatus("status").notNull(),
});

export const resolution = pgTable("resolution", {
  id: text("id").primaryKey(),
  splitId: text("split_id")
    .notNull()
    .references(() => split.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  proposedBy: text("proposed_by")
    .notNull()
    .references(() => participant.id, { onDelete: "cascade" }),
  draftedByModel: boolean("drafted_by_model").notNull().default(false),
  status: resolutionStatus("status").notNull(),
});

export const confirmation = pgTable(
  "confirmation",
  {
    resolutionId: text("resolution_id")
      .notNull()
      .references(() => resolution.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    at: at("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.resolutionId, t.participantId] })],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    decisionId: text("decision_id").references(() => decision.id, { onDelete: "cascade" }),
    resolutionId: text("resolution_id").references(() => resolution.id, { onDelete: "cascade" }),
    segmentId: text("segment_id")
      .notNull()
      .references(() => segment.id, { onDelete: "cascade" }),
    quote: text("quote").notNull(),
  },
  (t) => [
    check("evidence_one_target", sql`(${t.decisionId} is null) <> (${t.resolutionId} is null)`),
  ],
);

export const recordItem = pgTable("record_item", {
  id: text("id").primaryKey(),
  meetingId: meetingRef(),
  idx: integer("idx").notNull(),
  category: recordCategory("category").notNull(),
  text: text("text").notNull(),
  sourceRefs: jsonb("source_refs").$type<SourceRef[]>().notNull(),
  confirmedBy: jsonb("confirmed_by").$type<string[]>().notNull(),
  absent: jsonb("absent").$type<string[]>().notNull(),
  recheck: recheckResult("recheck").notNull(),
  splitId: text("split_id").references(() => split.id, { onDelete: "set null" }),
  deadline: jsonb("deadline").$type<RecordDeadline>(),
});

export const modelCall = pgTable(
  "model_call",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").references(() => meeting.id, { onDelete: "cascade" }),
    evalRunId: text("eval_run_id"),
    stage: text("stage").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    cacheHit: boolean("cache_hit").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    reasoningTokens: integer("reasoning_tokens"),
    costUsd: doublePrecision("cost_usd").notNull(),
    ok: boolean("ok").notNull(),
    error: text("error"),
    at: at("at").notNull(),
  },
  (t) => [index("model_call_meeting_idx").on(t.meetingId)],
);
