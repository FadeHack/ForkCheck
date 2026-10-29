import type { Confirmation, RecordItem, Resolution, Split, ValidityLabel } from "@forkcheck/core";
import { asc, eq, inArray } from "drizzle-orm";
import { toIso, type Db } from "../client";
import * as t from "../schema";

export class SplitRepo {
  constructor(private readonly db: Db) {}

  async create(splits: Split[]): Promise<void> {
    if (splits.length > 0) await this.db.insert(t.split).values(splits);
  }

  /** Saves a round's splits and marks the meeting revealed, together. */
  async saveReveal(meetingId: string, splits: Split[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (splits.length > 0) await tx.insert(t.split).values(splits);
      await tx
        .update(t.meeting)
        .set({ status: "revealed", error: null })
        .where(eq(t.meeting.id, meetingId));
    });
  }

  async get(id: string): Promise<Split | null> {
    const [row] = await this.db.select().from(t.split).where(eq(t.split.id, id));
    return row ?? null;
  }

  async list(meetingId: string): Promise<Split[]> {
    return this.db
      .select({
        id: t.split.id,
        probeId: t.split.probeId,
        outcome: t.split.outcome,
        validity: t.split.validity,
        status: t.split.status,
      })
      .from(t.split)
      .innerJoin(t.probe, eq(t.probe.id, t.split.probeId))
      .where(eq(t.probe.meetingId, meetingId))
      .orderBy(asc(t.split.id));
  }

  /**
   * Sets this participant's validity label, replacing any earlier one, while the split is
   * still open. The split row is held so two labels, or a label and the first proposal,
   * cannot overwrite each other. Returns null once resolution has started.
   */
  async labelIfOpen(
    id: string,
    participantId: string,
    label: ValidityLabel,
  ): Promise<Split | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(t.split).where(eq(t.split.id, id)).for("update");
      if (row?.status !== "open") return null;
      const validity = row.validity.some((v) => v.participantId === participantId)
        ? row.validity.map((v) =>
            v.participantId === participantId ? { participantId, label } : v,
          )
        : [...row.validity, { participantId, label }];
      await tx.update(t.split).set({ validity }).where(eq(t.split.id, id));
      return { ...row, validity };
    });
  }

  async update(s: Split): Promise<void> {
    const { id, ...rest } = s;
    await this.db.update(t.split).set(rest).where(eq(t.split.id, id));
  }

  async addResolution(r: Resolution): Promise<void> {
    await this.db.insert(t.resolution).values(r);
  }

  async setResolutionStatus(id: string, status: Resolution["status"]): Promise<void> {
    await this.db.update(t.resolution).set({ status }).where(eq(t.resolution.id, id));
  }

  async resolutions(splitIds: string[]): Promise<Resolution[]> {
    if (splitIds.length === 0) return [];
    return this.db
      .select()
      .from(t.resolution)
      .where(inArray(t.resolution.splitId, splitIds))
      .orderBy(asc(t.resolution.id));
  }

  /** Idempotent: a repeated confirmation keeps the first timestamp. */
  async confirm(c: Confirmation): Promise<void> {
    await this.db
      .insert(t.confirmation)
      .values({ ...c, at: new Date(c.at) })
      .onConflictDoNothing();
  }

  async confirmations(resolutionIds: string[]): Promise<Confirmation[]> {
    if (resolutionIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.confirmation)
      .where(inArray(t.confirmation.resolutionId, resolutionIds))
      .orderBy(asc(t.confirmation.at), asc(t.confirmation.participantId));
    return rows.map((r) => ({ ...r, at: toIso(r.at) }));
  }

  /** Replaces the stored record items of the meeting. */
  async saveRecord(meetingId: string, items: RecordItem[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.recordItem).where(eq(t.recordItem.meetingId, meetingId));
      if (items.length > 0) {
        await tx.insert(t.recordItem).values(items.map((item, idx) => ({ ...item, idx })));
      }
    });
  }

  async record(meetingId: string): Promise<RecordItem[]> {
    const rows = await this.db
      .select()
      .from(t.recordItem)
      .where(eq(t.recordItem.meetingId, meetingId))
      .orderBy(asc(t.recordItem.idx));
    return rows.map(({ idx: _idx, ...item }) => item);
  }
}
