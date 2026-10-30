import type {
  Answer,
  Candidate,
  Meeting,
  Participant,
  Probe,
  RecordItem,
  Resolution,
  Segment,
  Split,
} from "@forkcheck/core";
import { count, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  DbCallLog,
  MeetingRepo,
  RoundRepo,
  SplitRepo,
  tables,
  type Db,
  type StoredDecision,
} from "../src/index";
import { createTestDb } from "./pglite";

const M = "m1";

const meeting: Meeting = {
  id: M,
  title: "SSO pilot",
  source: "paste",
  status: "draft",
  heldAt: "2026-10-27T15:00:00.000Z",
  timezone: "America/New_York",
  transcriptVersion: 1,
  error: null,
  createdAt: "2026-10-27T16:00:00.000Z",
  deleteAfter: null,
};

const T0 = new Date("2026-10-27T16:30:00.000Z");
/** A claim at T0 that treats any run silent since T0 as gone. */
const claim = (runId: string) => ({ runId, now: T0, staleBefore: T0 });

const people: Participant[] = ["Ana", "Ben"].map((name, i) => ({
  id: `${M}:p:${i}`,
  meetingId: M,
  displayName: name,
  isSimulated: i === 1,
  status: "active",
}));
const [ana, ben] = people as [Participant, Participant];

const segments: Segment[] = ["Ana: We ship SSO on Friday.", "Ben: Fine, I'll own the rollout."].map(
  (text, idx) => ({
    id: `${M}:seg:${idx}`,
    meetingId: M,
    idx,
    speakerLabel: null,
    participantId: people[idx]!.id,
    startMs: null,
    endMs: null,
    text,
    origin: "paste",
    edited: false,
  }),
);

const decision: StoredDecision = {
  decision: {
    id: `${M}:dec:0`,
    meetingId: M,
    idx: 0,
    kind: "decision",
    statement: "Ship SSO on Friday",
    ownerText: "Ben",
    deadlineText: "Friday",
    ownerInferred: false,
    deadlineInferred: false,
    status: "ambiguous",
  },
  evidence: [
    {
      id: `${M}:dec:0:ev:0`,
      decisionId: `${M}:dec:0`,
      resolutionId: null,
      segmentId: `${M}:seg:0`,
      quote: "We ship SSO on Friday.",
    },
  ],
};

const candidate: Candidate = {
  id: `${M}:cand:0`,
  decisionId: `${M}:dec:0`,
  dimension: "scope",
  readings: [
    { id: `${M}:cand:0:r:0`, text: "staging" },
    { id: `${M}:cand:0:r:1`, text: "production" },
  ],
  impact: { reversibility: "medium", blastRadius: "high", timeToImpact: "high" },
};

const probe: Probe = {
  id: `${M}:cand:0:probe:0`,
  meetingId: M,
  kind: "diagnostic",
  candidateId: candidate.id,
  splitId: null,
  tier: "template",
  stem: "On Friday, where does SSO run?",
  options: [
    { id: `${M}:cand:0:probe:0:opt:0`, text: "Staging" },
    { id: `${M}:cand:0:probe:0:opt:1`, text: "Production" },
  ],
  lint: [],
  promptVersion: "template.v1",
  status: "draft",
};

const answers: Answer[] = [
  {
    id: "a0",
    probeId: probe.id,
    participantId: ana.id,
    choice: "option",
    optionId: probe.options[0]!.id,
    writeInText: null,
    mappedOptionId: null,
    mappedByModel: false,
    simulated: false,
  },
  {
    id: "a1",
    probeId: probe.id,
    participantId: ben.id,
    choice: "write_in",
    optionId: null,
    writeInText: "prod for the pilot tenant",
    mappedOptionId: probe.options[1]!.id,
    mappedByModel: true,
    simulated: false,
  },
];

const split: Split = {
  id: `${M}:split:0`,
  probeId: probe.id,
  outcome: "split",
  validity: [{ participantId: ana.id, label: "valid" }],
  status: "open",
};

const resolution: Resolution = {
  id: `${M}:res:0`,
  splitId: split.id,
  text: "Production for the pilot tenant only",
  proposedBy: ana.id,
  draftedByModel: false,
  status: "proposed",
};

const recordItem: RecordItem = {
  id: `${M}:item:0`,
  meetingId: M,
  category: "confirmed",
  text: "SSO goes to production for the pilot tenant on Friday",
  sourceRefs: [{ kind: "confirmation", resolutionId: resolution.id }],
  confirmedBy: [ana.id, ben.id],
  absent: [],
  recheck: "passed",
  splitId: split.id,
  deadline: { text: "Friday", date: "2026-10-30", firmness: "firm" },
};

async function seed(db: Db) {
  const meetings = new MeetingRepo(db);
  const rounds = new RoundRepo(db);
  const splits = new SplitRepo(db);
  await meetings.create({
    meeting,
    organizerTokenHash: "org-hash",
    participants: people.map((p, i) => ({ participant: p, tokenHash: `p-hash-${i}` })),
    segments,
  });
  await meetings.saveAnalysis(M, {
    decisions: [decision],
    candidates: [candidate],
    probes: [probe],
  });
  await rounds.open(
    {
      id: "r0",
      meetingId: M,
      kind: "diagnostic",
      openedAt: "2026-10-27T17:00:00.000Z",
      closedAt: null,
      closeReason: null,
    },
    [probe.id],
  );
  for (const a of answers) await rounds.putAnswer(a);
  await rounds.close("r0", "2026-10-27T18:00:00.000Z", "all_answered");
  await splits.create([split]);
  await splits.addResolution(resolution);
  await splits.confirm({
    resolutionId: resolution.id,
    participantId: ana.id,
    at: "2026-10-27T19:00:00.000Z",
  });
  await splits.saveRecord(M, [recordItem]);
  await db.insert(tables.audioAsset).values({ id: "audio0", meetingId: M, storageKey: "k" });
  await meetings.saveSpeakerMap(M, [{ label: "A", participantId: ana.id }]);
  await db.insert(tables.segmentEdit).values({
    id: "edit0",
    segmentId: segments[0]!.id,
    field: "text",
    before: "x",
    after: "y",
    editedBy: "organizer",
    at: new Date("2026-10-27T16:30:00.000Z"),
  });
  await db.insert(tables.evidence).values({
    id: "ev-res",
    decisionId: null,
    resolutionId: resolution.id,
    segmentId: segments[1]!.id,
    quote: "I'll own the rollout.",
  });
  await new DbCallLog(db, { meetingId: M }).write({
    at: "2026-10-27T16:45:00.000Z",
    stage: "extract",
    provider: "fake",
    model: "fake",
    promptVersion: "extract.v1",
    cacheHit: false,
    latencyMs: 12,
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: null,
    costUsd: 0.0002,
    ok: true,
    error: null,
  });
  return { meetings, rounds, splits };
}

const allTables = Object.values(tables).filter((v) => is(v, PgTable)) as PgTable[];

async function rowCount(db: Db, table: PgTable): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table);
  return row!.n;
}

// Each test boots a fresh PGlite and migrates it, which can pass 5 s when the full suite runs in parallel.
describe("repositories", { timeout: 20_000 }, () => {
  it("round-trip every aggregate through its domain type", async () => {
    const db = await createTestDb();
    const { meetings, rounds, splits } = await seed(db);

    expect(await meetings.get(M)).toEqual({ ...meeting, status: "probing" });
    expect(await meetings.analysisProgress(M)).toEqual({
      version: 1,
      step: "probes",
      failedStep: null,
      heartbeatAt: null,
    });
    expect(await meetings.organizerTokenHash(M)).toBe("org-hash");
    expect(await meetings.organizerTokenHash("nope")).toBeNull();
    expect(await meetings.findParticipantByTokenHash("p-hash-1")).toEqual(ben);
    expect(await meetings.participants(M)).toEqual(people);
    expect(await meetings.segments(M)).toEqual(segments);
    expect(await meetings.probes(M)).toEqual([
      { probe: { ...probe, status: "published" }, roundId: "r0" },
    ]);
    expect(await meetings.audioKeys(M)).toEqual(["k"]);
    expect(await meetings.analysis(M)).toEqual({
      decisions: [decision],
      candidates: [candidate],
      probes: [{ ...probe, status: "published" }],
    });

    expect(await rounds.get("r0")).toEqual({
      id: "r0",
      meetingId: M,
      kind: "diagnostic",
      openedAt: "2026-10-27T17:00:00.000Z",
      closedAt: "2026-10-27T18:00:00.000Z",
      closeReason: "all_answered",
    });
    expect(await rounds.probes("r0")).toEqual([{ ...probe, status: "published" }]);
    expect(await rounds.answers([probe.id])).toEqual(answers);
    expect(await rounds.answersBy(ben.id)).toEqual([answers[1]]);

    expect(await splits.get(split.id)).toEqual(split);
    expect(await splits.list(M)).toEqual([split]);
    expect(await splits.resolutions([split.id])).toEqual([resolution]);
    expect(await splits.confirmations([resolution.id])).toEqual([
      { resolutionId: resolution.id, participantId: ana.id, at: "2026-10-27T19:00:00.000Z" },
    ]);
    expect(await splits.record(M)).toEqual([recordItem]);

    const [call] = await db.select().from(tables.modelCall);
    expect(call).toMatchObject({
      meetingId: M,
      stage: "extract",
      costUsd: 0.0002,
      evalRunId: null,
    });
  });

  it("seed writes at least one row to every table", async () => {
    const db = await createTestDb();
    await seed(db);
    for (const table of allTables) {
      expect(await rowCount(db, table), getTableName(table)).toBeGreaterThan(0);
    }
  });

  it("deleting a meeting leaves zero rows in every child table", async () => {
    const db = await createTestDb();
    const { meetings } = await seed(db);
    expect(await meetings.delete(M)).toBe(true);
    for (const table of allTables) {
      expect(await rowCount(db, table), getTableName(table)).toBe(0);
    }
    expect(await meetings.delete(M)).toBe(false);
  });

  it("allows one answer per probe and participant; a resubmission replaces it", async () => {
    const db = await createTestDb();
    const { rounds } = await seed(db);
    await expect(db.insert(tables.answer).values({ ...answers[0]!, id: "dup" })).rejects.toThrow();
    const changed = await rounds.putAnswer({
      ...answers[0]!,
      id: "a0-again",
      choice: "unsure",
      optionId: null,
    });
    expect(changed).toMatchObject({ id: "a0", choice: "unsure", optionId: null });
    expect(await rounds.answers([probe.id])).toHaveLength(2);
  });

  it("opens one round at a time and takes answers only while it is open", async () => {
    const db = await createTestDb();
    const { rounds } = await seed(db);
    const r1 = {
      id: "r1",
      meetingId: M,
      kind: "diagnostic" as const,
      openedAt: "2026-10-27T19:00:00.000Z",
      closedAt: null,
      closeReason: null,
    };
    const both = await Promise.all([rounds.open(r1, []), rounds.open({ ...r1, id: "r2" }, [])]);
    expect(both.sort()).toEqual([false, true]);
    const opened = await rounds.openRound(M);
    expect(opened).toEqual({ ...r1, id: opened!.id });
    expect(await rounds.list(M)).toHaveLength(2);
    expect(await rounds.open({ ...r1, id: "r3" }, [])).toBe(false);

    // r0 closed in the seed: the answer is refused and the stored one is unchanged.
    const late = { ...answers[0]!, id: "late", choice: "unsure" as const, optionId: null };
    expect(await rounds.putAnswerIfOpen("r0", late)).toBeNull();
    expect((await rounds.answers([probe.id]))[0]).toEqual(answers[0]);
  });

  it("confirmations are idempotent", async () => {
    const db = await createTestDb();
    const { splits } = await seed(db);
    await splits.confirm({
      resolutionId: resolution.id,
      participantId: ana.id,
      at: "2026-10-28T00:00:00.000Z",
    });
    expect(await splits.confirmations([resolution.id])).toEqual([
      { resolutionId: resolution.id, participantId: ana.id, at: "2026-10-27T19:00:00.000Z" },
    ]);
  });

  it("rejects evidence with zero or two targets and answers whose fields contradict the choice", async () => {
    const db = await createTestDb();
    await seed(db);
    const base = { segmentId: segments[0]!.id, quote: "We ship" };
    await expect(
      db
        .insert(tables.evidence)
        .values({ ...base, id: "e-none", decisionId: null, resolutionId: null }),
    ).rejects.toThrow();
    await expect(
      db.insert(tables.evidence).values({
        ...base,
        id: "e-both",
        decisionId: decision.decision.id,
        resolutionId: resolution.id,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(tables.answer).values({
        ...answers[0]!,
        id: "bad",
        participantId: ana.id,
        probeId: probe.id,
        choice: "unsure",
      }),
    ).rejects.toThrow();
  });

  it("re-saving the analysis replaces it instead of duplicating rows", async () => {
    const db = await createTestDb();
    const meetings = new MeetingRepo(db);
    await meetings.create({
      meeting,
      organizerTokenHash: "h",
      participants: people.map((p, i) => ({ participant: p, tokenHash: `h-${i}` })),
      segments,
    });
    const analysis = { decisions: [decision], candidates: [candidate], probes: [probe] };
    await meetings.saveAnalysis(M, analysis);
    await meetings.saveAnalysis(M, analysis);
    expect(await meetings.analysis(M)).toEqual(analysis);
  });

  it("updates meeting and participant status", async () => {
    const db = await createTestDb();
    const { meetings } = await seed(db);
    await meetings.setStatus(M, "failed", "extract: timeout");
    expect(await meetings.get(M)).toMatchObject({ status: "failed", error: "extract: timeout" });
    expect(await meetings.setParticipantStatus(M, ben.id, "absent")).toEqual({
      ...ben,
      status: "absent",
    });
    expect(await meetings.setParticipantStatus("other", ben.id, "absent")).toBeNull();
  });

  it("lets a new run take over a step whose run went silent, and fences out the old one", async () => {
    const db = await createTestDb();
    const meetings = new MeetingRepo(db);
    await meetings.create({ meeting, organizerTokenHash: "h", participants: [], segments: [] });
    expect(await meetings.startAnalysis(M, ["draft"], claim("old"))).toBe(true);
    const later = new Date(T0.getTime() + 60_000);
    expect(await meetings.heartbeat(M, "old", later)).toBe(true);
    // Alive since T0 + 1 min: a claim that counts silence from then on cannot take over.
    expect(await meetings.startAnalysis(M, [], { ...claim("new"), staleBefore: later })).toBe(
      false,
    );
    const stale = new Date(later.getTime() + 1);
    expect(await meetings.startAnalysis(M, [], { ...claim("new"), staleBefore: stale })).toBe(true);
    expect(await meetings.heartbeat(M, "old", stale)).toBe(false);
    await meetings.failAnalysis(M, "old", "extract", "timeout");
    expect(await meetings.get(M)).toMatchObject({ status: "analyzing", error: null });
    expect(await meetings.heartbeat(M, "new", stale)).toBe(true);
  });

  it("records analysis progress step by step and only one caller starts it", async () => {
    const db = await createTestDb();
    const meetings = new MeetingRepo(db);
    await meetings.create({
      meeting,
      organizerTokenHash: "h",
      participants: people.map((p, i) => ({ participant: p, tokenHash: `h-${i}` })),
      segments,
    });
    const started = await Promise.all([
      meetings.startAnalysis(M, ["draft", "failed"], claim("run-a")),
      meetings.startAnalysis(M, ["draft", "failed"], claim("run-b")),
    ]);
    const runId = started[0] ? "run-a" : "run-b";
    expect([...started].sort()).toEqual([false, true]);
    await meetings.resetAnalysis(M, 1);
    await meetings.saveDecisions(M, [decision]);
    expect(await meetings.analysisProgress(M)).toEqual({
      version: 1,
      step: "extract",
      failedStep: null,
      heartbeatAt: T0.toISOString(),
    });
    // Only the run holding the step can fail it.
    await meetings.failAnalysis(M, "someone-else", "candidates", "timeout");
    expect(await meetings.get(M)).toMatchObject({ status: "analyzing" });
    await meetings.failAnalysis(M, runId, "candidates", "timeout");
    expect(await meetings.get(M)).toMatchObject({ status: "failed", error: "timeout" });
    expect(await meetings.analysisProgress(M)).toMatchObject({
      version: 1,
      step: "extract",
      failedStep: "candidates",
    });
    expect(await meetings.startAnalysis(M, ["draft"], claim("run-c"))).toBe(false);
    expect(await meetings.startAnalysis(M, ["failed"], claim("run-c"))).toBe(true);
    expect(await meetings.analysisProgress(M)).toMatchObject({ failedStep: null });
    await meetings.saveCandidates(M, [candidate]);
    const second = { ...probe, id: `${probe.id}b`, stem: "Second by rank" };
    await meetings.saveDraftProbes(M, [second, probe]);
    expect((await meetings.analysis(M)).probes.map((p) => p.id)).toEqual([second.id, probe.id]);
    expect(await meetings.get(M)).toMatchObject({ status: "probing", error: null });
  });
});
