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
import { and, asc, eq, inArray } from "drizzle-orm";
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

  /** Replaces any earlier analysis of the meeting in one transaction. */
  async saveAnalysis(meetingId: string, analysis: StoredAnalysis): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.probe).where(eq(t.probe.meetingId, meetingId));
      await tx.delete(t.decision).where(eq(t.decision.meetingId, meetingId));
      const decisions = analysis.decisions.map((d) => d.decision);
      const evidence = analysis.decisions.flatMap((d) => d.evidence);
      if (decisions.length > 0) await tx.insert(t.decision).values(decisions);
      if (evidence.length > 0) await tx.insert(t.evidence).values(evidence);
      if (analysis.candidates.length > 0) {
        await tx.insert(t.candidate).values(analysis.candidates);
      }
      if (analysis.probes.length > 0) {
        await tx.insert(t.probe).values(analysis.probes.map(probeRow));
      }
    });
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
        .orderBy(asc(t.probe.id)),
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

  /** Child rows go with it through `on delete cascade`. */
  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.meeting)
      .where(eq(t.meeting.id, id))
      .returning({ id: t.meeting.id });
    return rows.length > 0;
  }
}
