import {
  applyResolutionEvent,
  currentResolution,
  type Confirmation,
  type Participant,
  type RecordItem,
  type Resolution,
  type ResolutionState,
  type Split,
  type TransitionResult,
  type ValidityLabel,
} from "@forkcheck/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { toIso, type Db } from "../client";
import * as t from "../schema";
import { participantColumns } from "./meetings";

type SplitRow = typeof t.split.$inferSelect;

/** Resolution IDs end in a counter; ordering by length first keeps `:res:10` after `:res:9`. */
const resolutionOrder = [sql`length(${t.resolution.id})`, asc(t.resolution.id)];

/** The M1.13 state of a split, as stored: confirmations of the current resolution only. */
async function loadState(
  db: Db,
  split: SplitRow,
  participants: Pick<Participant, "id" | "status">[],
): Promise<ResolutionState> {
  const resolutions = await db
    .select()
    .from(t.resolution)
    .where(eq(t.resolution.splitId, split.id))
    .orderBy(...resolutionOrder);
  const state: ResolutionState = {
    splitId: split.id,
    status: split.status,
    participants,
    resolutions,
    confirmations: [],
    recheckInconclusive: false,
  };
  const current = currentResolution(state);
  if (current && split.status === "confirmed") {
    // A recheck's split is stored under its probe, `<splitId>:recheck:<resolutionId>`.
    const [recheck] = await db
      .select({ outcome: t.split.outcome })
      .from(t.split)
      .where(eq(t.split.id, `${split.id}:recheck:${current.id}:split`));
    state.recheckInconclusive = recheck?.outcome === "insufficient";
  }
  if (current) {
    const rows = await db
      .select()
      .from(t.confirmation)
      .where(eq(t.confirmation.resolutionId, current.id))
      .orderBy(asc(t.confirmation.at), asc(t.confirmation.participantId));
    state.confirmations = rows.map((r) => ({ ...r, at: toIso(r.at) }));
  }
  return state;
}

/** Writes what a transition changed. Confirmations of superseded resolutions stay as history. */
async function saveState(db: Db, before: ResolutionState, after: ResolutionState): Promise<void> {
  if (after.status !== before.status) {
    await db.update(t.split).set({ status: after.status }).where(eq(t.split.id, after.splitId));
  }
  for (const r of after.resolutions) {
    const old = before.resolutions.find((x) => x.id === r.id);
    if (!old) await db.insert(t.resolution).values(r);
    else if (old.status !== r.status) {
      await db.update(t.resolution).set({ status: r.status }).where(eq(t.resolution.id, r.id));
    }
  }
  const added = after.confirmations.filter(
    (c) =>
      !before.confirmations.some(
        (x) => x.resolutionId === c.resolutionId && x.participantId === c.participantId,
      ),
  );
  if (added.length > 0) {
    await db.insert(t.confirmation).values(added.map((c) => ({ ...c, at: new Date(c.at) })));
  }
}

const meetingParticipants = (db: Db, meetingId: string) =>
  db
    .select({ id: t.participant.id, status: t.participant.status })
    .from(t.participant)
    .where(eq(t.participant.meetingId, meetingId))
    .orderBy(asc(t.participant.id));

/** The meeting's split rows, locked in ID order so concurrent lockers can't deadlock. */
const lockSplits = (db: Db, meetingId: string) =>
  db
    .select({ split: t.split })
    .from(t.split)
    .innerJoin(t.probe, eq(t.probe.id, t.split.probeId))
    .where(eq(t.probe.meetingId, meetingId))
    .orderBy(asc(t.split.id))
    .for("update", { of: t.split });

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

  /** The split's resolution state as the state machine sees it, or null for an unknown split. */
  async state(id: string): Promise<ResolutionState | null> {
    const [row] = await this.db
      .select({ split: t.split, meetingId: t.probe.meetingId })
      .from(t.split)
      .innerJoin(t.probe, eq(t.probe.id, t.split.probeId))
      .where(eq(t.split.id, id));
    if (!row) return null;
    return loadState(this.db, row.split, await meetingParticipants(this.db, row.meetingId));
  }

  /**
   * Runs one state-machine step on a split and saves the result, holding the split row so
   * steps on the same split apply one at a time. Nothing is written when the step fails.
   * Returns null for an unknown split.
   */
  async transition(
    id: string,
    step: (s: ResolutionState) => TransitionResult,
  ): Promise<{ before: ResolutionState; result: TransitionResult } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ split: t.split, meetingId: t.probe.meetingId })
        .from(t.split)
        .innerJoin(t.probe, eq(t.probe.id, t.split.probeId))
        .where(eq(t.split.id, id))
        .for("update", { of: t.split });
      if (!row) return null;
      const before = await loadState(tx, row.split, await meetingParticipants(tx, row.meetingId));
      const result = step(before);
      if (result.ok) await saveState(tx, before, result.state);
      return { before, result };
    });
  }

  /**
   * Saves a recheck's split and applies its outcome to the split it rechecked, together.
   * The recheck split takes no labels or resolutions; the original split carries the state.
   * Returns the original split's transition, or null if that split is gone.
   */
  async saveRecheck(recheck: Split, originalId: string): Promise<TransitionResult | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ split: t.split, meetingId: t.probe.meetingId })
        .from(t.split)
        .innerJoin(t.probe, eq(t.probe.id, t.split.probeId))
        .where(eq(t.split.id, originalId))
        .for("update", { of: t.split });
      if (!row) return null;
      const before = await loadState(tx, row.split, await meetingParticipants(tx, row.meetingId));
      const result = applyResolutionEvent(before, { type: "recheck", outcome: recheck.outcome });
      if (!result.ok) return result;
      // The recheck's own split keeps the status its outcome led to, as a record of that step.
      await tx.insert(t.split).values({ ...recheck, status: result.state.status });
      await saveState(tx, before, result.state);
      return result;
    });
  }

  /**
   * Marks a participant active or absent and applies the change to every split of the
   * meeting: an absence can complete a confirmation, and a return that would undo one is
   * refused with nothing written. Returns null for an unknown participant.
   */
  async setParticipantStatus(
    meetingId: string,
    participantId: string,
    status: Participant["status"],
  ): Promise<
    | { ok: true; participant: Participant }
    | { ok: false; failed: Extract<TransitionResult, { ok: false }>; before: ResolutionState }
    | null
  > {
    return this.db.transaction(async (tx) => {
      const splits = await lockSplits(tx, meetingId);
      const participants = await meetingParticipants(tx, meetingId);
      if (!participants.some((p) => p.id === participantId)) return null;
      const changes: [ResolutionState, ResolutionState][] = [];
      for (const { split } of splits) {
        const before = await loadState(tx, split, participants);
        const result = applyResolutionEvent(before, {
          type: "set_participant_status",
          participantId,
          status,
        });
        if (!result.ok) return { ok: false, failed: result, before };
        changes.push([before, result.state]);
      }
      for (const [before, after] of changes) await saveState(tx, before, after);
      const [participant] = await tx
        .update(t.participant)
        .set({ status })
        .where(and(eq(t.participant.meetingId, meetingId), eq(t.participant.id, participantId)))
        .returning(participantColumns);
      return { ok: true, participant: participant! };
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

  async getResolution(id: string): Promise<Resolution | null> {
    const [row] = await this.db.select().from(t.resolution).where(eq(t.resolution.id, id));
    return row ?? null;
  }

  async resolutions(splitIds: string[]): Promise<Resolution[]> {
    if (splitIds.length === 0) return [];
    return this.db
      .select()
      .from(t.resolution)
      .where(inArray(t.resolution.splitId, splitIds))
      .orderBy(...resolutionOrder);
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
