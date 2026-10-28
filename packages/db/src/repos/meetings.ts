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
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { toIso, toIsoOrNull, type Db } from "../client";
import * as t from "../schema";

export interface NewMeeting {
  meeting: Meeting;
  organizerTokenHash: string;
  participants: { participant: Participant; tokenHash: string }[];
  segments: Segment[];
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

const participantColumns = {
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
        await tx
          .insert(t.participant)
          .values(input.participants.map((p) => ({ ...p.participant, tokenHash: p.tokenHash })));
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

  async segments(meetingId: string): Promise<Segment[]> {
    return this.db
      .select()
      .from(t.segment)
      .where(eq(t.segment.meetingId, meetingId))
      .orderBy(asc(t.segment.idx));
  }

  async setStatus(id: string, status: MeetingStatus, error: string | null = null): Promise<void> {
    await this.db.update(t.meeting).set({ status, error }).where(eq(t.meeting.id, id));
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
      })
      .from(t.meeting)
      .where(eq(t.meeting.id, id));
    return row ?? null;
  }

  /**
   * Moves the meeting to `analyzing` if its status is one of `from`. The check and the update
   * are one statement, so of two concurrent callers only one gets `true`.
   */
  async startAnalysis(id: string, from: readonly MeetingStatus[]): Promise<boolean> {
    const rows = await this.db
      .update(t.meeting)
      .set({ status: "analyzing", error: null, failedStep: null })
      .where(and(eq(t.meeting.id, id), inArray(t.meeting.status, [...from])))
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
        .set({ analysisStep: "probes", status: "probing", error: null, failedStep: null })
        .where(eq(t.meeting.id, meetingId));
    });
  }

  async failAnalysis(id: string, step: AnalysisStep, error: string): Promise<void> {
    await this.db
      .update(t.meeting)
      .set({ status: "failed", failedStep: step, error })
      .where(eq(t.meeting.id, id));
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

  /** Storage keys of audio not yet deleted, so a meeting delete can remove the files too. */
  async audioKeys(meetingId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: t.audioAsset.storageKey })
      .from(t.audioAsset)
      .where(and(eq(t.audioAsset.meetingId, meetingId), isNull(t.audioAsset.deletedAt)));
    return rows.map((r) => r.key);
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
