import { ScriptedProvider } from "@forkcheck/ai";
import type { Probe } from "@forkcheck/core";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as organizerGet } from "../../src/app/api/meetings/[id]/route";
import { POST as openRoute } from "../../src/app/api/meetings/[id]/rounds/route";
import { GET as participantGet } from "../../src/app/api/p/[token]/route";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { POST as closeRoute } from "../../src/app/api/rounds/[id]/close/route";
import type {
  CloseRoundResponse,
  OrganizerMeetingState,
  ParticipantState,
} from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { REVEAL_FAILED } from "../../src/server/reveal";
import { call, NOW, seedDrafts, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

type Seeded = Awaited<ReturnType<typeof seedDrafts>>;

function useModel(model: ScriptedProvider) {
  setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
}

/** A meeting with Ana, Ben and Cy and an open round of `count` questions. */
async function roundOf(id: string, count = 2) {
  const m = await seedDrafts(deps, id, ["Ana", "Ben", "Cy"], count);
  await call(
    openRoute,
    "/x",
    { id },
    { method: "POST", token: m.organizerToken, body: { probeIds: m.drafts.map((p) => p.id) } },
  );
  return { ...m, roundId: `${id}:round:0` };
}

const say = (m: Seeded, who: number, body: object) =>
  call(answerRoute, "/x", { token: m.participants[who]!.token }, { method: "POST", body });
const option = (probe: Probe, k: number) => ({
  probeId: probe.id,
  choice: "option",
  optionId: probe.options[k]!.id,
});
const unsure = (probe: Probe) => ({ probeId: probe.id, choice: "unsure" });
const writeIn = (probe: Probe, text: string) => ({
  probeId: probe.id,
  choice: "write_in",
  writeIn: text,
});

const close = (m: Seeded & { roundId: string }, token = m.organizerToken) =>
  call(closeRoute, "/x", { id: m.roundId }, { method: "POST", token });

const organizer = async (m: Seeded) =>
  (await call(organizerGet, "/x", { id: m.meeting.id }, { token: m.organizerToken }))
    .body as OrganizerMeetingState;

const participant = async (m: Seeded, who: number) =>
  (await call(participantGet, "/x", { token: m.participants[who]!.token }))
    .body as ParticipantState;

describe("POST /api/rounds/:id/close", () => {
  it("reveals the same splits to every participant and the organizer once all have answered", async () => {
    const m = await roundOf("rev-1");
    const [p0, p1] = m.drafts;
    const model = new ScriptedProvider({
      mapWriteIn: [{ optionId: "A", reason: "Staging is the first option." }],
    });
    useModel(model);
    await say(m, 0, option(p0!, 0));
    await say(m, 1, option(p0!, 1));
    await say(m, 2, unsure(p0!));
    await say(m, 0, option(p1!, 0));
    await say(m, 1, option(p1!, 0));
    await say(m, 2, writeIn(p1!, "the staging box"));

    const res = await close(m);
    expect(res.status).toBe(200);
    const body = res.body as CloseRoundResponse;
    expect(body.round).toMatchObject({ closedAt: NOW.toISOString(), closeReason: "all_answered" });
    expect(body.splits.map((s) => [s.probe.id, s.split.outcome])).toEqual([
      [p0!.id, "split"],
      [p1!.id, "consistent"],
    ]);
    // Stored option order, not anyone's shuffled order.
    expect(body.splits[0]!.probe.options).toEqual(p0!.options);
    expect(body.splits[1]!.answers.find((a) => a.choice === "write_in")).toMatchObject({
      writeInText: "the staging box",
      mappedOptionId: p1!.options[0]!.id,
      mappedByModel: true,
    });

    for (const who of [0, 1, 2]) {
      const view = await participant(m, who);
      expect(view.revealed).toEqual(body.splits);
      expect(view.openProbes).toEqual([]);
      expect(view.meeting.status).toBe("revealed");
    }
    const state = await organizer(m);
    expect(state.meeting.status).toBe("revealed");
    expect(state.splits).toEqual(body.splits.map((s) => s.split));
    expect(state.revealedAnswers).toEqual(body.splits.flatMap((s) => s.answers));
    expect(state.answerCounts).toEqual([]);
  });

  it("lists an unmapped write-in without counting it", async () => {
    const m = await roundOf("rev-unmapped", 1);
    const [p0] = m.drafts;
    useModel(new ScriptedProvider({ mapWriteIn: [{ optionId: null, reason: "Fits neither." }] }));
    await say(m, 0, option(p0!, 1));
    await say(m, 1, option(p0!, 1));
    await say(m, 2, writeIn(p0!, "a third environment entirely"));

    const body = (await close(m)).body as CloseRoundResponse;
    // Counted, the write-in would make this a split or block agreement; it does neither.
    expect(body.splits[0]!.split.outcome).toBe("consistent");
    expect(body.splits[0]!.answers.find((a) => a.choice === "write_in")).toMatchObject({
      writeInText: "a third environment entirely",
      mappedOptionId: null,
      mappedByModel: false,
    });
  });

  it("needs all answers, or at least 2 responders for an organizer close", async () => {
    const m = await roundOf("rev-quorum", 2);
    const [p0, p1] = m.drafts;
    useModel(new ScriptedProvider({}));
    await say(m, 0, option(p0!, 0));
    await say(m, 0, option(p1!, 0));
    expect(await close(m)).toMatchObject({ status: 409, body: { error: { code: "no_quorum" } } });
    expect((await deps.rounds.get(m.roundId))!.closedAt).toBeNull();
    expect((await organizer(m)).revealedAnswers).toEqual([]);

    await say(m, 1, option(p0!, 1));
    const res = await close(m);
    expect(res.status).toBe(200);
    const body = res.body as CloseRoundResponse;
    expect(body.round.closeReason).toBe("organizer_quorum");
    expect(body.splits.map((s) => s.split.outcome)).toEqual(["split", "insufficient"]);
    // Cy never answered: no row is invented, and divergence counts Cy as a non-responder.
    expect(body.splits.flatMap((s) => s.answers)).toHaveLength(3);
  });

  it("counts only active participants when deciding that all have answered", async () => {
    const m = await roundOf("rev-absent", 1);
    const [p0] = m.drafts;
    useModel(new ScriptedProvider({}));
    await deps.meetings.setParticipantStatus(
      m.meeting.id,
      m.participants[2]!.participant.id,
      "absent",
    );
    await say(m, 0, option(p0!, 0));
    await say(m, 1, option(p0!, 0));
    const body = (await close(m)).body as CloseRoundResponse;
    expect(body.round.closeReason).toBe("all_answered");
    expect(body.splits[0]!.split.outcome).toBe("consistent");
  });

  it("keeps answers sealed when matching fails, and a retry finishes the reveal", async () => {
    const m = await roundOf("rev-fail", 1);
    const [p0] = m.drafts;
    const model = new ScriptedProvider({
      mapWriteIn: [
        () => {
          throw new Error("upstream timeout");
        },
        { optionId: "B", reason: "Production." },
      ],
    });
    useModel(model);
    await say(m, 0, option(p0!, 0));
    await say(m, 1, writeIn(p0!, "the live servers"));

    const failed = await close(m);
    expect(failed).toMatchObject({
      status: 502,
      body: { error: { code: "reveal_failed", message: REVEAL_FAILED } },
    });
    const sealed = await organizer(m);
    expect(sealed.meeting).toMatchObject({ status: "probing", error: REVEAL_FAILED });
    expect(sealed.revealedAnswers).toEqual([]);
    expect(sealed.answerCounts).toEqual([
      { probeId: p0!.id, answered: 2, active: 3, answeredBy: expect.any(Array) },
    ]);
    expect(sealed.answerCounts[0]!.answeredBy).toHaveLength(2);
    expect((await participant(m, 0)).revealed).toEqual([]);
    // The round stays closed: no answer can change between the failure and the retry.
    expect((await say(m, 2, option(p0!, 1))).status).toBe(409);

    const retry = await close(m);
    expect(retry.status).toBe(200);
    expect((retry.body as CloseRoundResponse).splits[0]!.split.outcome).toBe("split");
    expect((await organizer(m)).meeting).toMatchObject({ status: "revealed", error: null });
  });

  it("returns the stored reveal on a repeat call, and runs once for two calls together", async () => {
    const m = await roundOf("rev-repeat", 1);
    const [p0] = m.drafts;
    const model = new ScriptedProvider({ mapWriteIn: [{ optionId: "A", reason: "Staging." }] });
    useModel(model);
    await say(m, 0, option(p0!, 0));
    await say(m, 1, writeIn(p0!, "staging first"));
    await say(m, 2, option(p0!, 0));

    const both = await Promise.all([close(m), close(m)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body).toMatchObject({
      error: { code: "reveal_running" },
    });
    const first = both.find((r) => r.status === 200)!;
    const again = await close(m);
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(model.requests).toHaveLength(1);
  });

  it("answers 401 to participants, other organizers and unknown rounds", async () => {
    const m = await roundOf("rev-auth", 1);
    const other = await seedDrafts(deps, "rev-auth-b", ["A", "B"], 1);
    expect((await close(m, m.participants[0]!.token)).status).toBe(401);
    expect((await close(m, other.organizerToken)).status).toBe(401);
    expect((await close({ ...m, roundId: "rev-auth:round:9" })).status).toBe(401);
  });
});
