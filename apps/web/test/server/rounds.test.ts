import { answer as answerSchema, optionOrder, type Answer, type Probe } from "@forkcheck/core";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as organizerGet } from "../../src/app/api/meetings/[id]/route";
import { POST as openRoute } from "../../src/app/api/meetings/[id]/rounds/route";
import { GET as participantGet } from "../../src/app/api/p/[token]/route";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { PATCH as participantPatch } from "../../src/app/api/meetings/[id]/participants/[pid]/route";
import { PATCH as editRoute } from "../../src/app/api/probes/[id]/route";
import type {
  OpenRoundResponse,
  OrganizerMeetingState,
  ParticipantState,
} from "../../src/contracts/api";
import type { Deps } from "../../src/server/deps";
import { call, NOW, seedDrafts, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

type Seeded = Awaited<ReturnType<typeof seedDrafts>>;

const open = (m: Seeded, probeIds: string[], token = m.organizerToken) =>
  call(openRoute, "/x", { id: m.meeting.id }, { method: "POST", token, body: { probeIds } });

const edit = (m: Seeded, id: string, body: unknown, token = m.organizerToken) =>
  call(editRoute, "/x", { id }, { method: "PATCH", token, body });

const view = async (token: string) =>
  (await call(participantGet, "/x", { token })).body as ParticipantState;

const answer = (token: string, body: unknown) =>
  call(answerRoute, "/x", { token }, { method: "POST", body });

const pick = (probe: Probe, k: number) => ({
  probeId: probe.id,
  choice: "option",
  optionId: probe.options[k]!.id,
});

describe("POST /api/meetings/:id/rounds", () => {
  it("publishes the chosen drafts and shows each participant only open questions", async () => {
    const m = await seedDrafts(deps, "open-1", ["Ana", "Ben"], 3);
    const before = await view(m.participants[0]!.token);
    expect(before.openProbes).toEqual([]);

    const res = await open(m, [m.drafts[2]!.id, m.drafts[0]!.id]);
    expect(res.status).toBe(201);
    expect((res.body as OpenRoundResponse).roundId).toBe("open-1:round:0");

    const state = (
      await call(organizerGet, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as OrganizerMeetingState;
    expect(state.probes.map((p) => p.status)).toEqual(["published", "draft", "published"]);
    expect(state.rounds).toEqual([
      {
        id: "open-1:round:0",
        meetingId: "open-1",
        kind: "diagnostic",
        openedAt: NOW.toISOString(),
        closedAt: null,
        closeReason: null,
      },
    ]);

    for (const { participant, token } of m.participants) {
      const mine = await view(token);
      expect(mine.participant).toEqual(participant);
      expect(mine.meeting).toEqual({ id: "open-1", title: "Meeting open-1", status: "probing" });
      // Rank order, options in this participant's seeded order, no lint or tier.
      expect(mine.openProbes).toEqual(
        [m.drafts[0]!, m.drafts[2]!].map((p) => {
          const { id, kind, splitId, stem, options } = optionOrder(p, participant.id);
          return { id, kind, splitId, stem, options };
        }),
      );
      expect(await view(token)).toEqual(mine);
    }
  });

  it("shuffles option order differently across participants", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `P${i}`);
    const m = await seedDrafts(deps, "open-shuffle", names, 1);
    const draft = m.drafts[0]!;
    await edit(m, draft.id, {
      options: ["On staging", "In production", "On both of them", "On neither one"],
    });
    expect((await open(m, [draft.id])).status).toBe(201);
    const ids = [0, 1, 2, 3].map((k) => `${draft.id}:opt:${k}`);
    const orders = new Set<string>();
    for (const { token } of m.participants) {
      const order = (await view(token)).openProbes[0]!.options.map((o) => o.id);
      expect([...order].sort()).toEqual(ids);
      orders.add(order.join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it.each([
    ["more than five", (m: Seeded) => m.drafts.map((p) => p.id), 400, "invalid_body"],
    ["a repeated ID", (m: Seeded) => [m.drafts[0]!.id, m.drafts[0]!.id], 400, "invalid_body"],
    ["an unknown ID", () => ["open-x:cand:0:probe:0"], 400, "invalid_body"],
  ] as const)("rejects %s", async (_label, ids, status, code) => {
    const m = await seedDrafts(deps, `open-bad-${status}-${Math.random()}`, ["A", "B"], 6);
    const res = await open(m, ids(m));
    expect(res).toMatchObject({ status, body: { error: { code } } });
    expect(await deps.rounds.list(m.meeting.id)).toEqual([]);
  });

  it("refuses withdrawn drafts, drafts that fail lint, and a second open round", async () => {
    const m = await seedDrafts(deps, "open-refuse", ["A", "B"], 3);
    await edit(m, m.drafts[0]!.id, { withdrawn: true });
    expect((await open(m, [m.drafts[0]!.id])).body).toMatchObject({
      error: { code: "not_draft" },
    });

    await edit(m, m.drafts[1]!.id, { stem: "Who is confused about where SSO runs?" });
    const lint = await open(m, [m.drafts[1]!.id, m.drafts[2]!.id]);
    expect(lint).toMatchObject({ status: 409, body: { error: { code: "lint_failed" } } });
    expect((lint.body as { error: { message: string } }).error.message).toContain(
      '"Who is confused about where SSO runs?"',
    );

    expect((await open(m, [m.drafts[2]!.id])).status).toBe(201);
    await edit(m, m.drafts[1]!.id, { stem: "Where does SSO run on Friday?" });
    expect(await open(m, [m.drafts[1]!.id])).toMatchObject({
      status: 409,
      body: { error: { code: "round_open" } },
    });
  });

  it("refuses a meeting that is not probing, and participant tokens", async () => {
    const m = await seedDrafts(deps, "open-status", ["A", "B"], 1);
    expect((await open(m, [m.drafts[0]!.id], m.participants[0]!.token)).status).toBe(401);
    await deps.meetings.setStatus(m.meeting.id, "revealed");
    const res = await call(
      openRoute,
      "/x",
      { id: m.meeting.id },
      { method: "POST", token: m.organizerToken, body: { probeIds: [m.drafts[0]!.id] } },
    );
    expect(res.body).toMatchObject({ error: { code: "not_probing" } });
  });
});

describe("PATCH /api/probes/:id", () => {
  it("edits a draft, reassigns option IDs and re-lints", async () => {
    const m = await seedDrafts(deps, "edit-1", ["A", "B"], 1);
    const id = m.drafts[0]!.id;
    const ok = await edit(m, id, {
      stem: "Where does SSO run first?",
      options: ["On staging", "In production", "For one tenant"],
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      stem: "Where does SSO run first?",
      options: [
        { id: `${id}:opt:0`, text: "On staging" },
        { id: `${id}:opt:1`, text: "In production" },
        { id: `${id}:opt:2`, text: "For one tenant" },
      ],
      lint: [],
      status: "draft",
    });

    const bad = (await edit(m, id, { stem: "Who and when? Is that correct?", options: ["A"] }))
      .body as Probe;
    expect(bad.lint.map((f) => f.rule).sort()).toEqual([
      "one_dimension",
      "option_count",
      "presupposition",
    ]);
    const [stored] = (await deps.meetings.probes(m.meeting.id)).map((p) => p.probe);
    expect(stored).toEqual(bad);
  });

  it("withdraws and restores a draft that was never sent", async () => {
    const m = await seedDrafts(deps, "edit-2", ["A", "B"], 1);
    const id = m.drafts[0]!.id;
    expect((await edit(m, id, { withdrawn: true })).body).toMatchObject({ status: "withdrawn" });
    expect((await edit(m, id, { withdrawn: false })).body).toMatchObject({ status: "draft" });
  });

  it("withdraws a sent question only while its round is open, and never edits or restores it", async () => {
    const m = await seedDrafts(deps, "edit-3", ["A", "B"], 2);
    const [sent, kept] = m.drafts;
    await open(m, [sent!.id, kept!.id]);
    const [ana] = m.participants;
    expect((await answer(ana!.token, pick(sent!, 0))).status).toBe(200);

    expect(await edit(m, sent!.id, { stem: "Changed?" })).toMatchObject({
      status: 409,
      body: { error: { code: "probe_sent" } },
    });
    expect((await edit(m, sent!.id, { withdrawn: true })).body).toMatchObject({
      status: "withdrawn",
    });
    expect((await view(ana!.token)).openProbes.map((p) => p.id)).toEqual([kept!.id]);
    expect(await answer(ana!.token, pick(sent!, 1))).toMatchObject({
      status: 409,
      body: { error: { code: "probe_withdrawn" } },
    });
    expect((await edit(m, sent!.id, { withdrawn: false })).body).toMatchObject({
      error: { code: "probe_sent" },
    });
    const state = (
      await call(organizerGet, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as OrganizerMeetingState;
    expect(state.answerCounts.map((c) => c.probeId)).toEqual([kept!.id]);

    await deps.rounds.close("edit-3:round:0", NOW.toISOString(), "organizer_quorum");
    expect((await edit(m, kept!.id, { withdrawn: true })).body).toMatchObject({
      error: { code: "round_closed" },
    });
  });

  it("answers 401 for another meeting's organizer, a participant, or an unknown ID", async () => {
    const a = await seedDrafts(deps, "edit-a", ["A", "B"], 1);
    const b = await seedDrafts(deps, "edit-b", ["A", "B"], 1);
    const id = a.drafts[0]!.id;
    expect((await edit(a, id, { withdrawn: true }, b.organizerToken)).status).toBe(401);
    expect((await edit(a, id, { withdrawn: true }, a.participants[0]!.token)).status).toBe(401);
    expect((await edit(a, "edit-a:nope", { withdrawn: true })).status).toBe(401);
    expect((await edit(a, id, {})).status).toBe(400);
  });
});

describe("POST /api/p/:token/answers", () => {
  it("two participants answer; each sees only their own answers", async () => {
    const m = await seedDrafts(deps, "ans-1", ["Ana", "Ben"], 2);
    const [p0, p1] = m.drafts;
    await open(m, [p0!.id, p1!.id]);
    const [ana, ben] = m.participants;

    const a0 = await answer(ana!.token, pick(p0!, 0));
    const a1 = await answer(ana!.token, { probeId: p1!.id, choice: "unsure" });
    const b0 = await answer(ben!.token, {
      probeId: p0!.id,
      choice: "write_in",
      writeIn: "Only the pilot tenant",
    });
    for (const r of [a0, a1, b0]) {
      expect(r.status).toBe(200);
      expect(answerSchema.parse(r.body)).toEqual(r.body);
    }
    expect(b0.body).toMatchObject({
      participantId: ben!.participant.id,
      choice: "write_in",
      writeInText: "Only the pilot tenant",
      mappedOptionId: null,
      mappedByModel: false,
    });

    expect((await view(ana!.token)).ownAnswers).toEqual(
      [a0.body, a1.body].sort((x, y) => (x as Answer).probeId.localeCompare((y as Answer).probeId)),
    );
    expect((await view(ben!.token)).ownAnswers).toEqual([b0.body]);
  });

  it("names who else still owes an answer, until they answer every open question", async () => {
    const m = await seedDrafts(deps, "wait-1", ["Ana", "Ben", "Cy", "Dee"], 2);
    const [p0, p1] = m.drafts;
    const [ana, ben, cy, dee] = m.participants;
    expect((await view(ana!.token)).waitingOn).toEqual([]);
    await open(m, [p0!.id, p1!.id]);
    expect((await view(ana!.token)).waitingOn).toEqual(["Ben", "Cy", "Dee"]);

    await answer(ben!.token, pick(p0!, 0));
    await answer(cy!.token, pick(p0!, 1));
    await answer(cy!.token, { probeId: p1!.id, choice: "unsure" });
    await call(
      participantPatch,
      "/x",
      { id: m.meeting.id, pid: dee!.participant.id },
      { method: "PATCH", token: m.organizerToken, body: { status: "absent" } },
    );
    // Ben answered one of two; Cy answered both; Dee is absent; Ana never counts herself.
    const state = await view(ana!.token);
    expect(state.waitingOn).toEqual(["Ben"]);
    // Names only: outside the participant list, nothing in Ana's view refers to anyone else.
    const rest = JSON.stringify({ ...state, participants: [] });
    for (const other of [ben, cy, dee]) expect(rest).not.toContain(other!.participant.id);
    expect((await view(ben!.token)).waitingOn).toEqual(["Ana"]);
  });

  it("is idempotent per question, and a new choice replaces the old one", async () => {
    const m = await seedDrafts(deps, "ans-2", ["Ana", "Ben"], 1);
    const probe = m.drafts[0]!;
    await open(m, [probe.id]);
    const token = m.participants[0]!.token;
    const first = await answer(token, pick(probe, 0));
    const again = await answer(token, pick(probe, 0));
    expect(again.body).toEqual(first.body);
    const changed = (await answer(token, pick(probe, 1))).body as Answer;
    expect(changed).toMatchObject({
      id: (first.body as Answer).id,
      optionId: probe.options[1]!.id,
    });
    expect(await deps.rounds.answers([probe.id])).toEqual([changed]);
  });

  it("rejects foreign options, unsent or foreign questions, and closed rounds", async () => {
    const m = await seedDrafts(deps, "ans-3", ["Ana", "Ben"], 2);
    const other = await seedDrafts(deps, "ans-3b", ["Cy", "Di"], 1);
    const [sent, draft] = m.drafts;
    await open(m, [sent!.id]);
    await open(other, [other.drafts[0]!.id]);
    const token = m.participants[0]!.token;

    expect(
      await answer(token, { probeId: sent!.id, choice: "option", optionId: draft!.options[0]!.id }),
    ).toMatchObject({ status: 400, body: { error: { fields: { optionId: expect.any(Array) } } } });
    expect((await answer(token, pick(draft!, 0))).status).toBe(404);
    expect((await answer(token, pick(other.drafts[0]!, 0))).status).toBe(404);
    expect((await answer(token, { probeId: sent!.id, choice: "option" })).status).toBe(400);
    expect((await answer("not-a-token", pick(sent!, 0))).status).toBe(401);

    await deps.rounds.close("ans-3:round:0", NOW.toISOString(), "organizer_quorum");
    expect(await answer(token, pick(sent!, 0))).toMatchObject({
      status: 409,
      body: { error: { code: "round_closed" } },
    });
    expect(await deps.rounds.answers([sent!.id])).toEqual([]);
  });
});

describe("sealed answers", () => {
  const action = fc.record({
    who: fc.nat({ max: 2 }),
    probe: fc.nat({ max: 1 }),
    choice: fc.constantFrom("option0", "option1", "unsure", "write_in"),
  });

  it("no response carries another participant's answer before the round closes", async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), async (actions) => {
        const m = await seedDrafts(deps, `leak-${run++}`, ["Ana", "Ben", "Cy"], 2);
        await open(
          m,
          m.drafts.map((p) => p.id),
        );
        const ids = m.participants.map((p) => p.participant.id);
        // Everything that identifies participant i's answers; write-in text is unique per action.
        const marks: string[][] = ids.map((id) => [`"${id}"`]);
        const bodies: { viewer: number | "organizer"; body: string }[] = [];

        for (const [step, a] of actions.entries()) {
          const probe = m.drafts[a.probe]!;
          const writeIn = `write-in ${a.who}-${step}`;
          const body =
            a.choice === "unsure"
              ? { probeId: probe.id, choice: "unsure" }
              : a.choice === "write_in"
                ? { probeId: probe.id, choice: "write_in", writeIn }
                : pick(probe, a.choice === "option0" ? 0 : 1);
          const res = await answer(m.participants[a.who]!.token, body);
          expect(res.status).toBe(200);
          marks[a.who]!.push(`"${(res.body as Answer).id}"`);
          if (a.choice === "write_in") marks[a.who]!.push(writeIn);
          bodies.push({ viewer: a.who, body: JSON.stringify(res.body) });
          for (const [i, { token }] of m.participants.entries()) {
            bodies.push({ viewer: i, body: JSON.stringify(await view(token)) });
          }
          const state = await call(
            organizerGet,
            "/x",
            { id: m.meeting.id },
            { token: m.organizerToken },
          );
          bodies.push({ viewer: "organizer", body: JSON.stringify(state.body) });
        }

        for (const { viewer, body } of bodies) {
          for (const [owner, ownerMarks] of marks.entries()) {
            if (owner === viewer) continue;
            // Everyone sees the participant list, but no one else's answer IDs or write-ins.
            for (const mark of ownerMarks.slice(1)) expect(body).not.toContain(mark);
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});
