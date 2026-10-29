import { readFileSync } from "node:fs";
import type { DecisionRecord, Meeting, Probe, RecordInput } from "@forkcheck/core";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as organizerRecord } from "../../src/app/api/meetings/[id]/record/route";
import { GET as participantRecord } from "../../src/app/api/p/[token]/record/route";
import type { RecordResponse } from "../../src/contracts/api";
import { createMemoryDb } from "@forkcheck/db/testing";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { hashToken, newToken } from "../../src/server/tokens";
import { call, seedRevealed, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

const DEMO = "demo-sso-pilot";
const snapshot = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/eval/test/__snapshots__/${name}`, import.meta.url),
      "utf8",
    ),
  );

/** The app lists participants by name; the loop keeps the scenario's order. Nothing else moves. */
function inAppOrder(record: DecisionRecord): DecisionRecord {
  const participants = record.participants.toSorted(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id),
  );
  const rank = (id: string) => participants.findIndex((p) => p.id === id);
  const byRank = (ids: string[]) => ids.toSorted((a, b) => rank(a) - rank(b));
  return {
    ...record,
    participants,
    items: record.items.map((i) => ({
      ...i,
      confirmedBy: byRank(i.confirmedBy),
      absent: byRank(i.absent),
    })),
  };
}

/**
 * Writes the M1.16 loop's end state for the demo scenario through the repositories: the
 * meeting, transcript, extracted items, the questions that split, and each split's
 * resolutions and confirmations.
 */
async function seedLoopEnd(deps: Deps, input: RecordInput) {
  const id = input.meeting.id;
  const meeting: Meeting = {
    id,
    title: input.meeting.title,
    source: "paste",
    status: "draft",
    heldAt: input.meeting.heldAt,
    timezone: "America/New_York",
    transcriptVersion: 1,
    error: null,
    createdAt: input.generatedAt,
    deleteAfter: null,
  };
  const organizerToken = newToken();
  const tokens = input.participants.map(() => newToken());
  await deps.meetings.create({
    meeting,
    organizerTokenHash: hashToken(organizerToken),
    participants: input.participants.map((participant, i) => ({
      participant,
      tokenHash: hashToken(tokens[i]!),
    })),
    segments: input.segments as Parameters<Deps["meetings"]["create"]>[0]["segments"],
  });

  const probes: Probe[] = input.splits.map(({ state }) => {
    const probeId = state.splitId.replace(/:split$/, "");
    return {
      id: probeId,
      meetingId: id,
      kind: "diagnostic",
      candidateId: `${probeId}:cand`,
      splitId: null,
      tier: "template",
      stem: `Question for ${probeId}`,
      options: [
        { id: `${probeId}:opt:0`, text: "One reading" },
        { id: `${probeId}:opt:1`, text: "Another reading" },
      ],
      lint: [],
      promptVersion: "template.v1",
      status: "draft",
    };
  });
  await deps.meetings.saveAnalysis(id, {
    decisions: input.decisions as Parameters<Deps["meetings"]["saveDecisions"]>[1],
    candidates: input.splits.map((s, k) => ({
      id: probes[k]!.candidateId!,
      decisionId: s.decisionId,
      dimension: s.dimension,
      readings: [
        { id: `${probes[k]!.id}:r:0`, text: "one" },
        { id: `${probes[k]!.id}:r:1`, text: "another" },
      ],
      impact: { reversibility: "medium", blastRadius: "high", timeToImpact: "high" },
    })),
    probes,
  });
  const roundId = `${id}:round:0`;
  await deps.rounds.open(
    {
      id: roundId,
      meetingId: id,
      kind: "diagnostic",
      openedAt: input.generatedAt,
      closedAt: null,
      closeReason: null,
    },
    probes.map((p) => p.id),
  );
  await deps.rounds.closeIfOpen(roundId, input.generatedAt, "all_answered");
  await deps.splits.saveReveal(
    id,
    input.splits.map(({ state }, k) => ({
      id: state.splitId,
      probeId: probes[k]!.id,
      outcome: "split",
      validity: [],
      status: state.status,
    })),
  );
  for (const { state } of input.splits) {
    expect(state.recheckInconclusive).toBe(false);
    for (const r of state.resolutions) await deps.splits.addResolution(r);
    for (const c of state.confirmations) await deps.splits.confirm(c);
  }
  return { organizerToken, participantToken: tokens[0]! };
}

describe("GET /api/meetings/:id/record", () => {
  for (const variant of ["precise", "vague"]) {
    it(`builds the M1.16 ${variant} demo record from stored state, for organizer and participants`, async () => {
      const input: RecordInput = snapshot(`${DEMO}-${variant}.record-input.json`);
      const expected: DecisionRecord = snapshot(`${DEMO}-${variant}.record.json`);
      const at = new Date(input.generatedAt);
      // Its own database: the scenario's participant IDs are the same in both variants.
      const { db, close } = await createMemoryDb();
      const own = createDeps(db, { now: () => at });
      setDeps(own);
      try {
        const { organizerToken, participantToken } = await seedLoopEnd(own, input);
        const res = await call(organizerRecord, "/x", { id: DEMO }, { token: organizerToken });
        expect(res.status).toBe(200);
        const body = res.body as RecordResponse;
        // Stored instants come back in UTC; the summary draft is only written on request.
        expect(body.record).toEqual(
          inAppOrder({
            ...expected,
            heldAt: new Date(expected.heldAt).toISOString(),
            generatedAt: at.toISOString(),
            proseDraft: null,
          }),
        );
        expect(body.validation).toEqual({ ok: true, findings: [] });

        const asParticipant = await call(participantRecord, "/x", { token: participantToken });
        expect(asParticipant).toMatchObject({ status: 200, body });
      } finally {
        setDeps(deps);
        await close();
      }
    });
  }

  it("shows failing items in the report instead of hiding them", async () => {
    // The seeded item has no quote, so it breaks the rule that every item has a source.
    const m = await seedRevealed(deps, "rec-failing");
    const body = (
      await call(organizerRecord, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as RecordResponse;
    expect(body.validation).toEqual({
      ok: false,
      findings: [
        {
          rule: "source_required",
          itemId: "rec-failing:item:0",
          detail: "no quote or confirmation",
        },
      ],
    });
    expect(body.record.items.map((i) => [i.id, i.category])).toEqual([
      ["rec-failing:item:0", "unresolved"],
    ]);
  });

  it("answers 401 without a valid token", async () => {
    const m = await seedRevealed(deps, "rec-auth");
    expect(
      (await call(organizerRecord, "/x", { id: m.meeting.id }, { token: m.participants[0]!.token }))
        .status,
    ).toBe(401);
    expect((await call(participantRecord, "/x", { token: "not-a-token" })).status).toBe(401);
  });
});
