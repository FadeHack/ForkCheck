import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbCallLog, tables } from "@forkcheck/db";
import { eq, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import type { CreateMeetingResponse } from "../../src/contracts/api";
import type { Deps } from "../../src/server/deps";
import { RETENTION_DAYS, sweepExpired } from "../../src/server/retention";
import { audioKey, LocalDiskStorage } from "../../src/server/storage";
import { call, NOW, seedRevealed, useTestDeps } from "./harness";

const DAY_MS = 24 * 60 * 60 * 1000;
let clock = NOW;
let deps: Deps;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forkcheck-retention-test-"));
  deps = await useTestDeps({ now: () => clock, storage: new LocalDiskStorage(root) });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Rows in every table of the app's schema, by table. */
async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of Object.values(tables)) {
    if (!is(table, PgTable)) continue;
    counts[getTableName(table)] = await deps.db.$count(table);
  }
  return counts;
}

/** A revealed meeting with a kept recording and a logged model call, expiring at `deleteAfter`. */
async function seedFull(id: string, deleteAfter: Date) {
  const m = await seedRevealed(deps, id);
  const storageKey = audioKey(id, "file-1");
  await deps.storage.put(storageKey, new Blob([new Uint8Array(64)]).stream(), { maxBytes: 1024 });
  await deps.meetings.addAudio({ id: `${id}:audio`, meetingId: id, storageKey });
  await deps.meetings.retainAudio(id);
  await new DbCallLog(deps.db, { meetingId: id }).write({
    at: NOW.toISOString(),
    stage: "extract",
    provider: "fake",
    model: "fixture",
    promptVersion: "extract-v1",
    cacheHit: false,
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: null,
    costUsd: 0,
    ok: true,
    error: null,
  });
  await deps.db.update(tables.meeting).set({ deleteAfter }).where(eq(tables.meeting.id, id));
  return m;
}

describe("retention", () => {
  it(`sets a new meeting to be deleted ${RETENTION_DAYS} days after it was created`, async () => {
    const res = await call(
      createRoute,
      "/api/meetings",
      {},
      {
        method: "POST",
        body: {
          title: "Weekly sync",
          heldAt: "2026-10-27T15:00:00-04:00",
          timezone: "America/New_York",
          participants: ["Priya", "Marco"],
          transcript: "Priya: We ship Friday.\nMarco: Agreed.",
        },
      },
    );
    const { meetingId } = res.body as CreateMeetingResponse;
    const meeting = (await deps.meetings.get(meetingId))!;
    expect(meeting.createdAt).toBe(NOW.toISOString());
    expect(meeting.deleteAfter).toBe(new Date(NOW.getTime() + 7 * DAY_MS).toISOString());
    await deps.meetings.delete(meetingId);
  });

  it("leaves an expired meeting with no rows and no stored audio after the sweep", async () => {
    const expiry = new Date(NOW.getTime() + RETENTION_DAYS * DAY_MS);
    await seedFull("kept", new Date(expiry.getTime() + DAY_MS));
    const before = await rowCounts();
    expect(Object.keys(before)).toEqual(expect.arrayContaining(["evidence", "record_item"]));

    await seedFull("expiring", expiry);
    expect(await readdir(join(root, "expiring"))).toEqual(["file-1"]);
    const seeded = await rowCounts();
    const filled = ["meeting", "participant", "decision", "candidate", "round", "probe", "answer"];
    for (const table of [...filled, "split", "audio_asset", "model_call"]) {
      expect(seeded[table], table).toBeGreaterThan(before[table]!);
    }

    // A minute early, nothing goes.
    clock = new Date(expiry.getTime() - 60_000);
    expect(await sweepExpired(deps)).toBe(0);
    expect(await deps.meetings.get("expiring")).not.toBeNull();

    clock = expiry;
    expect(await sweepExpired(deps)).toBe(1);
    expect(await rowCounts()).toEqual(before);
    expect(await readdir(join(root, "expiring"))).toEqual([]);

    // The other meeting is untouched, recording included.
    expect(await deps.meetings.get("kept")).not.toBeNull();
    expect(await readdir(join(root, "kept"))).toEqual(["file-1"]);
    expect(await sweepExpired(deps)).toBe(0);
  });
});
