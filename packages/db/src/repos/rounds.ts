import type { Answer, Probe, Round } from "@forkcheck/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { toIso, toIsoOrNull, type Db } from "../client";
import * as t from "../schema";
import { probeOrder, probeRow, toProbe } from "./meetings";

type RoundRow = typeof t.round.$inferSelect;

const toRound = (r: RoundRow): Round => ({
  id: r.id,
  meetingId: r.meetingId,
  kind: r.kind,
  openedAt: toIso(r.openedAt),
  closedAt: toIsoOrNull(r.closedAt),
  closeReason: r.closeReason,
});

async function upsertAnswer(db: Db, a: Answer): Promise<Answer> {
  const { id, ...rest } = a;
  const [row] = await db
    .insert(t.answer)
    .values(a)
    .onConflictDoUpdate({ target: [t.answer.probeId, t.answer.participantId], set: rest })
    .returning();
  if (row === undefined) throw new Error(`answer ${id} was not written`);
  return row;
}

export class RoundRepo {
  constructor(private readonly db: Db) {}

  /**
   * Opens the round and publishes its probes, unless the meeting already has an open round:
   * then nothing is written and it returns false. The meeting row is locked so two opens
   * cannot both pass the check. Recheck probes are inserted here, not by analysis.
   */
  async open(round: Round, probeIds: string[], newProbes: Probe[] = []): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: t.meeting.id })
        .from(t.meeting)
        .where(eq(t.meeting.id, round.meetingId))
        .for("update");
      const [open] = await tx
        .select({ id: t.round.id })
        .from(t.round)
        .where(and(eq(t.round.meetingId, round.meetingId), isNull(t.round.closedAt)));
      if (open) return false;
      await tx.insert(t.round).values({
        ...round,
        openedAt: new Date(round.openedAt),
        closedAt: round.closedAt === null ? null : new Date(round.closedAt),
      });
      if (newProbes.length > 0) {
        await tx
          .insert(t.probe)
          .values(newProbes.map((p) => ({ ...probeRow(p), roundId: round.id })));
      }
      const ids = [...probeIds, ...newProbes.map((p) => p.id)];
      if (ids.length > 0) {
        await tx
          .update(t.probe)
          .set({ roundId: round.id, status: "published" })
          .where(and(eq(t.probe.meetingId, round.meetingId), inArray(t.probe.id, ids)));
      }
      return true;
    });
  }

  async openRound(meetingId: string): Promise<Round | null> {
    const [row] = await this.db
      .select()
      .from(t.round)
      .where(and(eq(t.round.meetingId, meetingId), isNull(t.round.closedAt)));
    return row ? toRound(row) : null;
  }

  async get(id: string): Promise<Round | null> {
    const [row] = await this.db.select().from(t.round).where(eq(t.round.id, id));
    return row ? toRound(row) : null;
  }

  async list(meetingId: string): Promise<Round[]> {
    const rows = await this.db
      .select()
      .from(t.round)
      .where(eq(t.round.meetingId, meetingId))
      .orderBy(asc(t.round.openedAt), asc(t.round.id));
    return rows.map(toRound);
  }

  async probes(roundId: string): Promise<Probe[]> {
    const rows = await this.db
      .select()
      .from(t.probe)
      .where(eq(t.probe.roundId, roundId))
      .orderBy(...probeOrder);
    return rows.map(toProbe);
  }

  async getProbe(id: string): Promise<{ probe: Probe; roundId: string | null } | null> {
    const [row] = await this.db.select().from(t.probe).where(eq(t.probe.id, id));
    return row ? { probe: toProbe(row), roundId: row.roundId } : null;
  }

  async updateProbe(p: Probe): Promise<void> {
    const { id, ...rest } = probeRow(p);
    await this.db.update(t.probe).set(rest).where(eq(t.probe.id, id));
  }

  /** One answer per (probe, participant): a second submission replaces the first. */
  async putAnswer(a: Answer): Promise<Answer> {
    return upsertAnswer(this.db, a);
  }

  /**
   * Writes the answer only while its round is open, holding the round row so a close
   * cannot land between the check and the write. Returns null when the round is closed.
   */
  async putAnswerIfOpen(roundId: string, a: Answer): Promise<Answer | null> {
    return this.db.transaction(async (tx) => {
      const [open] = await tx
        .select({ id: t.round.id })
        .from(t.round)
        .where(and(eq(t.round.id, roundId), isNull(t.round.closedAt)))
        .for("update");
      return open ? upsertAnswer(tx, a) : null;
    });
  }

  async answers(probeIds: string[]): Promise<Answer[]> {
    if (probeIds.length === 0) return [];
    return this.db
      .select()
      .from(t.answer)
      .where(inArray(t.answer.probeId, probeIds))
      .orderBy(asc(t.answer.probeId), asc(t.answer.participantId));
  }

  async answersBy(participantId: string): Promise<Answer[]> {
    return this.db
      .select()
      .from(t.answer)
      .where(eq(t.answer.participantId, participantId))
      .orderBy(asc(t.answer.probeId));
  }

  async close(
    id: string,
    closedAt: string,
    reason: NonNullable<Round["closeReason"]>,
  ): Promise<void> {
    await this.db
      .update(t.round)
      .set({ closedAt: new Date(closedAt), closeReason: reason })
      .where(eq(t.round.id, id));
  }
}
