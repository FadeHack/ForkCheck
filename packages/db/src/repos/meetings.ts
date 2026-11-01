import { randomUUID } from "node:crypto";
import type {
  Candidate,
  Decision,
  Evidence,
  Meeting,
  MeetingStatus,
  Participant,
  Probe,
  Segment,
} from "@forkcheck/core";
import { and, asc, eq, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { toIso, toIsoOrNull, type Db } from "../client";
import * as t from "../schema";

export interface NewMeeting {
  meeting: Meeting;
  organizerTokenHash: string;
  participants: {
    participant: Participant;
    tokenHash: string;
    simulatorNotes?: string | undefined;
  }[];
  segments: Segment[];
}

/** A transcription label and who it is; null is the organizer's explicit "unknown". */
export interface SpeakerAssignment {
  label: string;
  participantId: string | null;
}

/** One logged change to a turn during transcript review. */
export interface SegmentEdit {
  id: string;
  segmentId: string;
  field: "text" | "participantId";
  /** A participant ID for `participantId`; null is an unknown speaker. */
  before: string | null;
  after: string | null;
  at: string;
}

export interface SegmentChange {
  text?: string | undefined;
  participantId?: string | null | undefined;
}

/** Same shape as the engine's DecisionWithEvidence; db may not import the engine. */
export interface StoredDecision {
  decision: Decision;
  evidence: Evidence[];
}

export interface StoredAnalysis {
  decisions: StoredDecision[];
  candidates: Candidate[];
  probes: Probe[];
}

export type AnalysisStep = (typeof t.analysisStep.enumValues)[number];

export interface AnalysisProgress {
  version: number | null;
  step: AnalysisStep | null;
  failedStep: AnalysisStep | null;
  /** When the run holding the meeting last showed it was alive. */
  heartbeatAt: string | null;
}

/** A run claiming a long step; a holder silent since `staleBefore` may be replaced. */
export interface StepClaim {
  runId: string;
  now: Date;
  staleBefore: Date;
}

type MeetingRow = typeof t.meeting.$inferSelect;
type ProbeRow = typeof t.probe.$inferSelect;

export const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  title: r.title,
  source: r.source,
  status: r.status,
  heldAt: toIso(r.heldAt),
  timezone: r.timezone,
  transcriptVersion: r.transcriptVersion,
  error: r.error,
  createdAt: toIso(r.createdAt),
  deleteAfter: toIsoOrNull(r.deleteAfter),
});

export const toProbe = (r: ProbeRow): Probe => ({
  id: r.id,
  meetingId: r.meetingId,
  kind: r.kind,
  candidateId: r.candidateId,
  splitId: r.splitId,
  tier: r.tier,
  stem: r.stem,
  options: r.options,
  lint: r.lint,
  promptVersion: r.promptVersion,
  status: r.status,
});

export const probeRow = (p: Probe): typeof t.probe.$inferInsert => ({ ...p });
export const probeOrder = [sql`${t.probe.rank} asc nulls last`, asc(t.probe.id)];

export const participantColumns = {
  id: t.participant.id,
  meetingId: t.participant.meetingId,
  displayName: t.participant.displayName,
  isSimulated: t.participant.isSimulated,
  status: t.participant.status,
};

export class MeetingRepo {
  constructor(private readonly db: Db) {}

  async create(input: NewMeeting): Promise<void> {
    const m = input.meeting;
    await this.db.transaction(async (tx) => {
      await tx.insert(t.meeting).values({
        ...m,
        heldAt: new Date(m.heldAt),
        createdAt: new Date(m.createdAt),
        deleteAfter: m.deleteAfter === null ? null : new Date(m.deleteAfter),
        organizerTokenHash: input.organizerTokenHash,
      });
      if (input.participants.length > 0) {
        await tx.insert(t.participant).values(
          input.participants.map((p) => ({
            ...p.participant,
            tokenHash: p.tokenHash,
            simulatorNotes: p.simulatorNotes ?? null,
          })),
        );
      }
      if (input.segments.length > 0) await tx.insert(t.segment).values(input.segments);
    });
  }

  async get(id: string): Promise<Meeting | null> {
    const [row] = await this.db.select().from(t.meeting).where(eq(t.meeting.id, id));
    return row ? toMeeting(row) : null;
  }

  /** The stored hash, so the caller can compare in constant time. */
  async organizerTokenHash(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ hash: t.meeting.organizerTokenHash })
      .from(t.meeting)
      .where(eq(t.meeting.id, id));
    return row?.hash ?? null;
  }

  async findParticipantByTokenHash(hash: string): Promise<Participant | null> {
    const [row] = await this.db
      .select(participantColumns)
      .from(t.participant)
      .where(eq(t.participant.tokenHash, hash));
    return row ?? null;
  }

  async participants(meetingId: string): Promise<Participant[]> {
    return this.db
      .select(participantColumns)
      .from(t.participant)
      .where(eq(t.participant.meetingId, meetingId))
      .orderBy(asc(t.participant.displayName), asc(t.participant.id));
  }

  /** The private notes each simulated participant answers from, by participant ID. */
  async simulatorNotes(meetingId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: t.participant.id, notes: t.participant.simulatorNotes })
      .from(t.participant)
      .where(and(eq(t.participant.meetingId, meetingId), eq(t.participant.isSimulated, true)));
    return new Map(rows.map((r) => [r.id, r.notes ?? ""]));
  }

  async segments(meetingId: string): Promise<Segment[]> {
    return this.db
      .select()
      .from(t.segment)
      .where(eq(t.segment.meetingId, meetingId))
      .orderBy(asc(t.segment.idx));
  }

  async segment(id: string): Promise<Segment | null> {
    const [row] = await this.db.select().from(t.segment).where(eq(t.segment.id, id));
    return row ?? null;
  }

  /**
   * Applies the fields that differ, logs each one and bumps the transcript version, so stored
   * analysis no longer matches. Nothing is written when no field changes. Returns null if the
   * meeting left `review` in the meantime.
   */
  async editSegment(
    id: string,
    change: SegmentChange,
    by: string,
    at: Date,
  ): Promise<Segment | null> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(t.segment).where(eq(t.segment.id, id));
      if (!current) return null;
      const fields = (["text", "participantId"] as const).filter(
        (f) => change[f] !== undefined && change[f] !== current[f],
      );
      if (fields.length === 0) return current;
      const bumped = await tx
        .update(t.meeting)
        .set({ transcriptVersion: sql`${t.meeting.transcriptVersion} + 1` })
        .where(and(eq(t.meeting.id, current.meetingId), eq(t.meeting.status, "review")))
        .returning({ id: t.meeting.id });
      if (bumped.length === 0) return null;
      await tx.insert(t.segmentEdit).values(
        fields.map((field) => ({
          id: randomUUID(),
          segmentId: id,
          field,
          before: current[field],
          after: change[field] ?? null,
          editedBy: by,
          at,
        })),
      );
      const [updated] = await tx
        .update(t.segment)
        .set({ ...Object.fromEntries(fields.map((f) => [f, change[f]])), edited: true })
        .where(eq(t.segment.id, id))
        .returning();
      return updated!;
    });
  }

  async segmentEdits(meetingId: string): Promise<SegmentEdit[]> {
    const rows = await this.db
      .select({
        id: t.segmentEdit.id,
        segmentId: t.segmentEdit.segmentId,
        field: t.segmentEdit.field,
        before: t.segmentEdit.before,
        after: t.segmentEdit.after,
        at: t.segmentEdit.at,
      })
      .from(t.segmentEdit)
      .innerJoin(t.segment, eq(t.segment.id, t.segmentEdit.segmentId))
      .where(eq(t.segment.meetingId, meetingId))
      .orderBy(asc(t.segmentEdit.at), asc(t.segmentEdit.field));
    return rows.map((r) => ({
      ...r,
      field: r.field as SegmentEdit["field"],
      at: toIso(r.at),
    }));
  }

  async setStatus(id: string, status: MeetingStatus, error: string | null = null): Promise<void> {
    await this.db.update(t.meeting).set({ status, error }).where(eq(t.meeting.id, id));
  }

  /**
   * Clears the meeting's error if it is still `error`. A retry after a failed step calls this
   * first, so only one of two concurrent retries resumes.
   */
  async claimError(id: string, error: string): Promise<boolean> {
    const rows = await this.db
      .update(t.meeting)
      .set({ error: null })
      .where(and(eq(t.meeting.id, id), eq(t.meeting.error, error)))
      .returning({ id: t.meeting.id });
    return rows.length > 0;
  }

  async setParticipantStatus(
    meetingId: string,
    participantId: string,
    status: Participant["status"],
  ): Promise<Participant | null> {
    const [row] = await this.db
      .update(t.participant)
      .set({ status })
      .where(and(eq(t.participant.meetingId, meetingId), eq(t.participant.id, participantId)))
      .returning(participantColumns);
    return row ?? null;
  }

  async analysisProgress(id: string): Promise<AnalysisProgress | null> {
    const [row] = await this.db
      .select({
        version: t.meeting.analysisVersion,
        step: t.meeting.analysisStep,
        failedStep: t.meeting.failedStep,
        heartbeatAt: t.meeting.stepHeartbeatAt,
      })
      .from(t.meeting)
      .where(eq(t.meeting.id, id));
    return row ? { ...row, heartbeatAt: toIsoOrNull(row.heartbeatAt) } : null;
  }

  /**
   * Moves the meeting to `analyzing` for this run if its status is one of `from`, or if an
   * earlier run has been silent since `staleBefore`. The check and the update are one
   * statement, so of two concurrent callers only one gets `true`.
   */
  async startAnalysis(
    id: string,
    from: readonly MeetingStatus[],
    claim: StepClaim,
  ): Promise<boolean> {
    return this.claimStep(id, "analyzing", from, claim);
  }

  /** As `startAnalysis`, for `transcribing`. */
  async startTranscription(
    id: string,
    from: readonly MeetingStatus[],
    claim: StepClaim,
  ): Promise<boolean> {
    return this.claimStep(id, "transcribing", from, claim);
  }

  private async claimStep(
    id: string,
    running: "analyzing" | "transcribing",
    from: readonly MeetingStatus[],
    claim: StepClaim,
  ): Promise<boolean> {
    const rows = await this.db
      .update(t.meeting)
      .set({
        status: running,
        error: null,
        failedStep: null,
        stepRunId: claim.runId,
        stepHeartbeatAt: claim.now,
      })
      .where(
        and(
          eq(t.meeting.id, id),
          or(
            inArray(t.meeting.status, [...from]),
            and(
              eq(t.meeting.status, running),
              or(
                isNull(t.meeting.stepHeartbeatAt),
                lt(t.meeting.stepHeartbeatAt, claim.staleBefore),
              ),
            ),
          ),
        ),
      )
      .returning({ id: t.meeting.id });
    return rows.length > 0;
  }

  /** Records that the run is alive; false once another run has taken the step over. */
  async heartbeat(id: string, runId: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(t.meeting)
      .set({ stepHeartbeatAt: now })
      .where(and(eq(t.meeting.id, id), eq(t.meeting.stepRunId, runId)))
      .returning({ id: t.meeting.id });
    return rows.length > 0;
  }

  /** Drops any earlier analysis and binds the next one to `version`. */
  async resetAnalysis(meetingId: string, version: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.probe).where(eq(t.probe.meetingId, meetingId));
      await tx.delete(t.decision).where(eq(t.decision.meetingId, meetingId));
      await tx
        .update(t.meeting)
        .set({ analysisVersion: version, analysisStep: null })
        .where(eq(t.meeting.id, meetingId));
    });
  }

  async saveDecisions(meetingId: string, decisions: StoredDecision[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = decisions.map((d) => d.decision);
      const evidence = decisions.flatMap((d) => d.evidence);
      if (rows.length > 0) await tx.insert(t.decision).values(rows);
      if (evidence.length > 0) await tx.insert(t.evidence).values(evidence);
      await tx
        .update(t.meeting)
        .set({ analysisStep: "extract" })
        .where(eq(t.meeting.id, meetingId));
    });
  }

  async saveCandidates(meetingId: string, candidates: Candidate[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (candidates.length > 0) await tx.insert(t.candidate).values(candidates);
      await tx
        .update(t.meeting)
        .set({ analysisStep: "candidates" })
        .where(eq(t.meeting.id, meetingId));
    });
  }

  /** Stores drafts in the given order and finishes the analysis: the meeting moves to `probing`. */
  async saveDraftProbes(meetingId: string, probes: Probe[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (probes.length > 0) {
        await tx.insert(t.probe).values(probes.map((p, rank) => ({ ...probeRow(p), rank })));
      }
      await tx
        .update(t.meeting)
        .set({
          analysisStep: "probes",
          status: "probing",
          error: null,
          failedStep: null,
          stepRunId: null,
        })
        .where(eq(t.meeting.id, meetingId));
    });
  }

  /** Marks the step failed, unless another run has taken it over since. */
  async failAnalysis(id: string, runId: string, step: AnalysisStep, error: string): Promise<void> {
    await this.db
      .update(t.meeting)
      .set({ status: "failed", failedStep: step, error, stepRunId: null })
      .where(and(eq(t.meeting.id, id), eq(t.meeting.stepRunId, runId)));
  }

  /**
   * Replaces the meeting's segments with a transcription and moves it to `review`. A new
   * transcript version invalidates any earlier analysis. False if another run took over.
   */
  async saveTranscript(
    meetingId: string,
    runId: string,
    input: { segments: Segment[]; storageKey: string; durationMs: number },
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(t.meeting)
        .set({
          status: "review",
          error: null,
          stepRunId: null,
          transcriptVersion: sql`${t.meeting.transcriptVersion} + 1`,
        })
        .where(and(eq(t.meeting.id, meetingId), eq(t.meeting.stepRunId, runId)))
        .returning({ id: t.meeting.id });
      if (rows.length === 0) return false;
      await tx.delete(t.segment).where(eq(t.segment.meetingId, meetingId));
      if (input.segments.length > 0) await tx.insert(t.segment).values(input.segments);
      // Labels belong to one transcription; a new one starts unmapped.
      await tx.delete(t.speakerMap).where(eq(t.speakerMap.meetingId, meetingId));
      await tx
        .update(t.audioAsset)
        .set({ durationMs: input.durationMs })
        .where(
          and(eq(t.audioAsset.meetingId, meetingId), eq(t.audioAsset.storageKey, input.storageKey)),
        );
      return true;
    });
  }

  /** Marks transcription failed, unless another run has taken it over since. */
  async failTranscription(id: string, runId: string, error: string): Promise<void> {
    await this.db
      .update(t.meeting)
      .set({ status: "failed", error, stepRunId: null })
      .where(and(eq(t.meeting.id, id), eq(t.meeting.stepRunId, runId)));
  }

  /** All three steps at once, for seeding. */
  async saveAnalysis(meetingId: string, analysis: StoredAnalysis): Promise<void> {
    const meeting = await this.get(meetingId);
    await this.resetAnalysis(meetingId, meeting?.transcriptVersion ?? 0);
    await this.saveDecisions(meetingId, analysis.decisions);
    await this.saveCandidates(meetingId, analysis.candidates);
    await this.saveDraftProbes(meetingId, analysis.probes);
  }

  async analysis(meetingId: string): Promise<StoredAnalysis> {
    const decisionRows = await this.db
      .select()
      .from(t.decision)
      .where(eq(t.decision.meetingId, meetingId))
      .orderBy(asc(t.decision.idx));
    const decisionIds = decisionRows.map((d) => d.id);
    const [evidenceRows, candidates, probeRows] = await Promise.all([
      decisionIds.length === 0
        ? []
        : this.db
            .select()
            .from(t.evidence)
            .where(inArray(t.evidence.decisionId, decisionIds))
            .orderBy(asc(t.evidence.id)),
      decisionIds.length === 0
        ? []
        : this.db
            .select()
            .from(t.candidate)
            .where(inArray(t.candidate.decisionId, decisionIds))
            .orderBy(asc(t.candidate.id)),
      this.db
        .select()
        .from(t.probe)
        .where(and(eq(t.probe.meetingId, meetingId), eq(t.probe.kind, "diagnostic")))
        .orderBy(...probeOrder),
    ]);
    return {
      decisions: decisionRows.map((decision) => ({
        decision,
        evidence: evidenceRows.filter((e) => e.decisionId === decision.id),
      })),
      candidates,
      probes: probeRows.map(toProbe),
    };
  }

  /** Every probe of the meeting, diagnostic and recheck, with the round it was published in. */
  async probes(meetingId: string): Promise<{ probe: Probe; roundId: string | null }[]> {
    const rows = await this.db
      .select()
      .from(t.probe)
      .where(eq(t.probe.meetingId, meetingId))
      .orderBy(...probeOrder);
    return rows.map((r) => ({ probe: toProbe(r), roundId: r.roundId }));
  }

  async speakerMap(meetingId: string): Promise<SpeakerAssignment[]> {
    return this.db
      .select({ label: t.speakerMap.label, participantId: t.speakerMap.participantId })
      .from(t.speakerMap)
      .where(eq(t.speakerMap.meetingId, meetingId))
      .orderBy(asc(t.speakerMap.label));
  }

  /**
   * Saves who each label is and sets every turn with that label to them, except turns the
   * organizer reassigned one by one in review. The caller checks the mapping covers each label
   * once and names only this meeting's participants.
   */
  async saveSpeakerMap(meetingId: string, mapping: SpeakerAssignment[]): Promise<Segment[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(t.speakerMap).where(eq(t.speakerMap.meetingId, meetingId));
      if (mapping.length > 0) {
        await tx.insert(t.speakerMap).values(mapping.map((m) => ({ meetingId, ...m })));
      }
      const reassigned = tx
        .select({ id: t.segmentEdit.segmentId })
        .from(t.segmentEdit)
        .where(eq(t.segmentEdit.field, "participantId"));
      for (const { label, participantId } of mapping) {
        await tx
          .update(t.segment)
          .set({ participantId })
          .where(
            and(
              eq(t.segment.meetingId, meetingId),
              eq(t.segment.speakerLabel, label),
              notInArray(t.segment.id, reassigned),
            ),
          );
      }
      return tx
        .select()
        .from(t.segment)
        .where(eq(t.segment.meetingId, meetingId))
        .orderBy(asc(t.segment.idx));
    });
  }

  /** Records an uploaded file; audio is not kept after review unless `retain` is set later. */
  async addAudio(input: { id: string; meetingId: string; storageKey: string }): Promise<void> {
    await this.db.insert(t.audioAsset).values(input);
  }

  /** Whether `storageKey` is live audio of this meeting, so a client-sent key cannot reach another meeting's file. */
  async hasAudio(meetingId: string, storageKey: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.audioAsset.id })
      .from(t.audioAsset)
      .where(
        and(
          eq(t.audioAsset.meetingId, meetingId),
          eq(t.audioAsset.storageKey, storageKey),
          isNull(t.audioAsset.deletedAt),
        ),
      );
    return rows.length > 0;
  }

  /** The recording not yet deleted; uploads retire the previous one, so there is at most one. */
  async liveAudio(
    meetingId: string,
  ): Promise<{ storageKey: string; durationMs: number | null; retain: boolean } | null> {
    const [row] = await this.db
      .select({
        storageKey: t.audioAsset.storageKey,
        durationMs: t.audioAsset.durationMs,
        retain: t.audioAsset.retain,
      })
      .from(t.audioAsset)
      .where(and(eq(t.audioAsset.meetingId, meetingId), isNull(t.audioAsset.deletedAt)));
    return row ?? null;
  }

  /** Keeps the live recording after review, so quotes in the record can be played. */
  async retainAudio(meetingId: string): Promise<void> {
    await this.db
      .update(t.audioAsset)
      .set({ retain: true })
      .where(and(eq(t.audioAsset.meetingId, meetingId), isNull(t.audioAsset.deletedAt)));
  }

  /** Records that the stored files are gone; the rows stay as the deletion log. */
  async markAudioDeleted(meetingId: string, keys: string[], at: Date): Promise<void> {
    if (keys.length === 0) return;
    await this.db
      .update(t.audioAsset)
      .set({ deletedAt: at })
      .where(and(eq(t.audioAsset.meetingId, meetingId), inArray(t.audioAsset.storageKey, keys)));
  }

  /** Storage keys of audio not yet deleted, so a meeting delete can remove the files too. */
  async audioKeys(meetingId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: t.audioAsset.storageKey })
      .from(t.audioAsset)
      .where(and(eq(t.audioAsset.meetingId, meetingId), isNull(t.audioAsset.deletedAt)));
    return rows.map((r) => r.key);
  }

  /** Meetings whose retention ran out at or before `now`. */
  async expired(now: Date): Promise<string[]> {
    const rows = await this.db
      .select({ id: t.meeting.id })
      .from(t.meeting)
      .where(lte(t.meeting.deleteAfter, now));
    return rows.map((r) => r.id);
  }

  /** Child rows go with it through `on delete cascade`. */
  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.meeting)
      .where(eq(t.meeting.id, id))
      .returning({ id: t.meeting.id });
    return rows.length > 0;
  }
}
