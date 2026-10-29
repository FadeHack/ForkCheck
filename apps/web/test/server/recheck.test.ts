import { ScriptedProvider } from "@forkcheck/ai";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { POST as confirmRoute } from "../../src/app/api/p/[token]/resolutions/[rid]/confirm/route";
import { POST as resolutionsRoute } from "../../src/app/api/p/[token]/resolutions/route";
import { GET as participantGet } from "../../src/app/api/p/[token]/route";
import { POST as validityRoute } from "../../src/app/api/p/[token]/validity/route";
import { POST as closeRoute } from "../../src/app/api/rounds/[id]/close/route";
import { POST as recheckRoute } from "../../src/app/api/splits/[id]/recheck/route";
import type {
  CloseRoundResponse,
  ParticipantState,
  ProposeResolutionResponse,
  StartRecheckResponse,
} from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { call, NOW, seedRevealed, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

type Revealed = Awaited<ReturnType<typeof seedRevealed>>;

const consequence = {
  consequence: "Where pilot admins sign in on Monday.",
  stem: "On Monday morning, which system do the pilot admins sign in to?",
  options: [{ text: "The staging system" }, { text: "The production system" }],
};

function useModel(...recheck: object[]) {
  const model = new ScriptedProvider({ generateRecheck: recheck });
  setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
  return model;
}

const token = (m: Revealed, who: number) => m.participants[who]!.token;

const recheck = (m: Revealed, organizerToken = m.organizerToken) =>
  call(recheckRoute, "/x", { id: m.splitId }, { method: "POST", token: organizerToken });

/** Ana proposes and, unless `confirmers` says otherwise, all three confirm. */
async function resolved(m: Revealed, confirmers = [0, 1, 2]) {
  const { id } = (
    await call(
      resolutionsRoute,
      "/x",
      { token: token(m, 0) },
      { method: "POST", body: { splitId: m.splitId, text: "SSO runs on staging on Friday." } },
    )
  ).body as ProposeResolutionResponse;
  for (const who of confirmers) {
    await call(confirmRoute, "/x", { token: token(m, who), rid: id }, { method: "POST" });
  }
  return id;
}

/** Each entry is an option index, "unsure", or null for no answer. */
async function answerAndClose(
  m: Revealed,
  started: StartRecheckResponse,
  picks: (number | "unsure" | null)[],
) {
  for (const [who, pick] of picks.entries()) {
    if (pick === null) continue;
    const body =
      pick === "unsure"
        ? { probeId: started.probe.id, choice: "unsure" }
        : {
            probeId: started.probe.id,
            choice: "option",
            optionId: started.probe.options[pick]!.id,
          };
    expect(
      (await call(answerRoute, "/x", { token: token(m, who) }, { method: "POST", body })).status,
    ).toBe(200);
  }
  return call(
    closeRoute,
    "/x",
    { id: started.roundId },
    { method: "POST", token: m.organizerToken },
  );
}

const original = async (m: Revealed) => (await deps.splits.state(m.splitId))!;

describe("POST /api/splits/:id/recheck", () => {
  it("is refused until the resolution is confirmed", async () => {
    const m = await seedRevealed(deps, "rc-early");
    const model = useModel(consequence);
    expect(await recheck(m)).toMatchObject({
      status: 409,
      body: { error: { code: "not_confirmed" } },
    });
    await resolved(m, [0, 1]);
    expect(await recheck(m)).toMatchObject({
      status: 409,
      body: { error: { code: "not_confirmed" } },
    });
    expect(model.requests).toHaveLength(0);
    expect(await deps.rounds.openRound(m.meeting.id)).toBeNull();
  });

  it("passes when everyone gives the same answer", async () => {
    const m = await seedRevealed(deps, "rc-pass");
    await resolved(m);
    useModel(consequence);
    const res = await recheck(m);
    expect(res.status).toBe(201);
    const started = res.body as StartRecheckResponse;
    expect(started.probe).toMatchObject({
      kind: "recheck",
      splitId: m.splitId,
      status: "published",
      stem: consequence.stem,
    });

    const view = (await call(participantGet, "/x", { token: token(m, 1) }))
      .body as ParticipantState;
    expect(view.openProbes.map((p) => p.id)).toEqual([started.probe.id]);

    const closed = await answerAndClose(m, started, [0, 0, 0]);
    expect(closed.status).toBe(200);
    const body = closed.body as CloseRoundResponse;
    expect(body.round).toMatchObject({ kind: "recheck", closeReason: "all_answered" });
    expect(body.splits.map((s) => [s.probe.id, s.split.outcome])).toEqual([
      [started.probe.id, "consistent"],
    ]);
    expect((await original(m)).status).toBe("rechecked");
    expect((await deps.meetings.get(m.meeting.id))!.status).toBe("revealed");
    // A repeat close returns the same reveal.
    expect(
      await call(
        closeRoute,
        "/x",
        { id: started.roundId },
        { method: "POST", token: m.organizerToken },
      ),
    ).toMatchObject({ status: 200, body });
  });

  it("reopens the split when answers differ, and the group resolves it again", async () => {
    const m = await seedRevealed(deps, "rc-reopen");
    await resolved(m);
    useModel(consequence);
    const started = (await recheck(m)).body as StartRecheckResponse;
    const body = (await answerAndClose(m, started, [0, 1, 1])).body as CloseRoundResponse;
    expect(body.splits[0]!.split.outcome).toBe("split");
    expect((await original(m)).status).toBe("reopened");

    // Labels and proposals go on the original question, not the recheck's.
    const onRecheck = await call(
      validityRoute,
      "/x",
      { token: token(m, 0) },
      { method: "POST", body: { splitId: body.splits[0]!.split.id, label: "valid" } },
    );
    expect(onRecheck).toMatchObject({ status: 409, body: { error: { code: "recheck_question" } } });
    await resolved(m);
    expect((await original(m)).status).toBe("confirmed");
    useModel(consequence);
    expect((await recheck(m)).status).toBe(201);
  });

  it("leaves the split confirmed but not conclusive when too few answer definitely", async () => {
    const m = await seedRevealed(deps, "rc-insufficient");
    await resolved(m);
    useModel(consequence);
    const started = (await recheck(m)).body as StartRecheckResponse;
    const closed = await answerAndClose(m, started, [0, "unsure", null]);
    expect(closed).toMatchObject({
      status: 200,
      body: { round: { closeReason: "organizer_quorum" } },
    });
    expect((closed.body as CloseRoundResponse).splits[0]!.split.outcome).toBe("insufficient");
    expect(await original(m)).toMatchObject({ status: "confirmed", recheckInconclusive: true });
    expect(await recheck(m)).toMatchObject({
      status: 409,
      body: { error: { code: "already_rechecked" } },
    });
  });

  it("resumes a recheck reveal whose write-in matching failed", async () => {
    const m = await seedRevealed(deps, "rc-retry");
    await resolved(m);
    const model = new ScriptedProvider({
      generateRecheck: [consequence],
      mapWriteIn: [
        () => {
          throw new Error("upstream timeout");
        },
        { optionId: "A", reason: "Staging." },
      ],
    });
    setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
    const started = (await recheck(m)).body as StartRecheckResponse;
    await call(
      answerRoute,
      "/x",
      { token: token(m, 2) },
      {
        method: "POST",
        body: { probeId: started.probe.id, choice: "write_in", writeIn: "staging" },
      },
    );
    expect((await answerAndClose(m, started, [0, 0, null])).status).toBe(502);
    expect((await original(m)).status).toBe("confirmed");
    const view = (await call(participantGet, "/x", { token: token(m, 0) }))
      .body as ParticipantState;
    expect(view.revealed.map((r) => r.probe.id)).not.toContain(started.probe.id);

    const retry = await call(
      closeRoute,
      "/x",
      { id: started.roundId },
      { method: "POST", token: m.organizerToken },
    );
    expect(retry.status).toBe(200);
    expect((retry.body as CloseRoundResponse).splits[0]!.split.outcome).toBe("consistent");
    expect((await original(m)).status).toBe("rechecked");
  });

  it("sends nothing when both attempts fail the checks", async () => {
    const m = await seedRevealed(deps, "rc-lint");
    await resolved(m);
    const echo = { ...consequence, stem: "Question 0: where does SSO run on Friday?" };
    const model = useModel(echo, echo);
    expect(await recheck(m)).toMatchObject({
      status: 409,
      body: { error: { code: "recheck_failed" } },
    });
    expect(model.requests).toHaveLength(2);
    expect(await deps.rounds.openRound(m.meeting.id)).toBeNull();
    expect((await original(m)).status).toBe("confirmed");
  });

  it("answers 401 to participants, other organizers and unknown splits", async () => {
    const m = await seedRevealed(deps, "rc-auth");
    const other = await seedRevealed(deps, "rc-auth-b");
    expect((await recheck(m, token(m, 0))).status).toBe(401);
    expect((await recheck(m, other.organizerToken)).status).toBe(401);
    expect((await recheck({ ...m, splitId: "nope" })).status).toBe(401);
  });
});
