import { ScriptedProvider } from "@forkcheck/ai";
import type { Answer } from "@forkcheck/core";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as organizerGet } from "../../src/app/api/meetings/[id]/route";
import { GET as recordRoute } from "../../src/app/api/meetings/[id]/record/route";
import { POST as openRoute } from "../../src/app/api/meetings/[id]/rounds/route";
import { POST as simulateRoute } from "../../src/app/api/meetings/[id]/simulate/route";
import { GET as participantGet } from "../../src/app/api/p/[token]/route";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { POST as confirmRoute } from "../../src/app/api/p/[token]/resolutions/[rid]/confirm/route";
import { POST as resolutionsRoute } from "../../src/app/api/p/[token]/resolutions/route";
import { POST as closeRoute } from "../../src/app/api/rounds/[id]/close/route";
import { POST as recheckRoute } from "../../src/app/api/splits/[id]/recheck/route";
import type {
  CloseRoundResponse,
  OrganizerMeetingState,
  ParticipantState,
  ProposeResolutionResponse,
  RecordResponse,
  StartRecheckResponse,
} from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { call, NOW, seedDrafts, seedRevealed, useTestDeps, type SeededMeeting } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

const STAGING = "Ben: SSO goes to staging on Friday; the live rollout waits for the pilot.";
const PRODUCTION = "Cy: SSO goes straight to production on Friday.";
const people = ["Ana", { name: "Ben", notes: STAGING }, { name: "Cy", notes: PRODUCTION }];

type Request = { messages: { content: string }[] };

/** Picks the option the notes name, as the simulator is told to. */
const fromNotes = (req: Request) => {
  const lines = req.messages[1]!.content.split("\n");
  const where = lines[1]!.includes("production") ? "In production" : "On staging";
  return { optionId: lines.find((l) => l.endsWith(where))![0], reason: "From the notes." };
};

function useModel(...replies: unknown[]) {
  const model = new ScriptedProvider({ simulateAnswer: replies });
  setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
  return model;
}

const simulate = (m: SeededMeeting, token = m.organizerToken) =>
  call(simulateRoute, "/x", { id: m.meeting.id }, { method: "POST", token });

/** Ana, real, and Ben and Cy, simulated, with a round of `count` questions open. */
async function mixed(id: string, count = 2) {
  const m = await seedDrafts(deps, id, people, count);
  await call(
    openRoute,
    "/x",
    { id },
    { method: "POST", token: m.organizerToken, body: { probeIds: m.drafts.map((p) => p.id) } },
  );
  return { ...m, roundId: `${id}:round:0` };
}

const anaAnswers = (m: Awaited<ReturnType<typeof mixed>>) =>
  Promise.all(
    m.drafts.map((p) =>
      call(
        answerRoute,
        "/x",
        { token: m.participants[0]!.token },
        { method: "POST", body: { probeId: p.id, choice: "option", optionId: p.options[0]!.id } },
      ),
    ),
  );

/** Ana is the only real participant: every other answer must carry the label. */
const labeledByPerson = (m: SeededMeeting, answers: Answer[]) =>
  answers.map((a) => [
    m.participants.findIndex((p) => p.participant.id === a.participantId),
    a.simulated,
  ]);

describe("POST /api/meetings/:id/simulate", () => {
  it("answers for simulated participants beside a real one, labeled in reveal and record", async () => {
    const m = await mixed("sim-mixed");
    const model = useModel(fromNotes, fromNotes, fromNotes, fromNotes);
    await anaAnswers(m);

    expect(await simulate(m)).toMatchObject({ status: 200, body: { submitted: 4 } });
    // Sealed until the round closes, for the organizer and for Ana.
    const sealed = (
      await call(organizerGet, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as OrganizerMeetingState;
    expect(sealed.revealedAnswers).toEqual([]);
    expect(sealed.answerCounts.map((c) => c.answered)).toEqual([3, 3]);
    const ana = (await call(participantGet, "/x", { token: m.participants[0]!.token }))
      .body as ParticipantState;
    expect(ana.ownAnswers.map((a) => a.participantId)).toEqual([
      m.participants[0]!.participant.id,
      m.participants[0]!.participant.id,
    ]);
    // Each simulated participant sees only their own notes.
    for (const req of model.requests) {
      const notes = req.messages[1]!.content;
      expect(notes.includes(STAGING)).not.toBe(notes.includes(PRODUCTION));
    }

    const closed = await call(
      closeRoute,
      "/x",
      { id: m.roundId },
      { method: "POST", token: m.organizerToken },
    );
    expect(closed.status).toBe(200);
    const reveal = closed.body as CloseRoundResponse;
    expect(reveal.round.closeReason).toBe("all_answered");
    expect(reveal.splits.map((s) => s.split.outcome)).toEqual(["split", "split"]);
    for (const s of reveal.splits) {
      expect(labeledByPerson(m, s.answers).sort()).toEqual([
        [0, false],
        [1, true],
        [2, true],
      ]);
      const ben = s.answers.find((a) => a.participantId === m.participants[1]!.participant.id)!;
      expect(ben.optionId).toBe(s.probe.options.find((o) => o.text === "On staging")!.id);
    }
    const state = (
      await call(organizerGet, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as OrganizerMeetingState;
    expect(labeledByPerson(m, state.revealedAnswers).filter(([who]) => who !== 0)).toEqual(
      Array(4).fill([expect.any(Number), true]),
    );
    const view = (await call(participantGet, "/x", { token: m.participants[0]!.token }))
      .body as ParticipantState;
    expect(view.revealed).toEqual(reveal.splits);

    const record = (
      await call(recordRoute, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as RecordResponse;
    expect(record.record.participants.map((p) => [p.displayName, p.isSimulated])).toEqual([
      ["Ana", false],
      ["Ben", true],
      ["Cy", true],
    ]);
    const payloads = JSON.stringify([sealed, ana, reveal, state, view, record]);
    expect(payloads).not.toContain(STAGING);
    expect(payloads).not.toContain(PRODUCTION);
  });

  it("skips answered questions, so a repeat after a failure answers the rest", async () => {
    const m = await mixed("sim-retry");
    const model = useModel(fromNotes, () => {
      throw new Error("upstream timeout");
    });
    expect(await simulate(m)).toMatchObject({
      status: 502,
      body: { error: { code: "simulate_failed" } },
    });
    useModel(fromNotes, fromNotes, fromNotes);
    expect(await simulate(m)).toMatchObject({ status: 200, body: { submitted: 3 } });
    expect(model.requests).toHaveLength(2);
    expect(await simulate(m)).toMatchObject({ status: 200, body: { submitted: 0 } });
    const answers = await deps.rounds.answers(m.drafts.map((p) => p.id));
    expect(answers.map((a) => a.simulated)).toEqual([true, true, true, true]);
  });

  it("answers a recheck knowing the resolution everyone confirmed", async () => {
    const m = await seedRevealed(deps, "sim-recheck", people);
    const { id } = (
      await call(
        resolutionsRoute,
        "/x",
        { token: m.participants[0]!.token },
        { method: "POST", body: { splitId: m.splitId, text: "SSO runs on staging on Friday." } },
      )
    ).body as ProposeResolutionResponse;
    for (const p of m.participants) {
      await call(confirmRoute, "/x", { token: p.token, rid: id }, { method: "POST" });
    }
    const recheckModel = new ScriptedProvider({
      generateRecheck: [
        {
          consequence: "Where pilot admins sign in on Monday.",
          stem: "On Monday morning, which system do the pilot admins sign in to?",
          options: [{ text: "The staging system" }, { text: "The production system" }],
        },
      ],
    });
    setDeps(createDeps(deps.db, { now: () => NOW, model: () => recheckModel }));
    const started = (
      await call(recheckRoute, "/x", { id: m.splitId }, { method: "POST", token: m.organizerToken })
    ).body as StartRecheckResponse;

    const model = useModel({ optionId: "A", reason: "" }, { optionId: "A", reason: "" });
    expect(await simulate(m)).toMatchObject({ status: 200, body: { submitted: 2 } });
    for (const req of model.requests) {
      expect(req.messages[1]!.content).toContain(
        'Everyone then confirmed: "SSO runs on staging on Friday."',
      );
    }
    const answers = await deps.rounds.answers([started.probe.id]);
    expect(answers.map((a) => a.simulated)).toEqual([true, true]);
  });

  it("labels an answer typed on a simulated participant's link", async () => {
    const m = await mixed("sim-link", 1);
    const p = m.drafts[0]!;
    const res = await call(
      answerRoute,
      "/x",
      { token: m.participants[1]!.token },
      { method: "POST", body: { probeId: p.id, choice: "unsure" } },
    );
    expect(res.body).toMatchObject({ simulated: true });
  });

  it("needs an open round and a simulated participant present", async () => {
    const closed = await seedDrafts(deps, "sim-none", people, 1);
    const model = useModel();
    expect(await simulate(closed)).toMatchObject({
      status: 409,
      body: { error: { code: "no_open_round" } },
    });
    const real = await mixed("sim-real", 1);
    for (const who of [1, 2]) {
      await deps.meetings.setParticipantStatus(
        real.meeting.id,
        real.participants[who]!.participant.id,
        "absent",
      );
    }
    expect(await simulate(real)).toMatchObject({
      status: 409,
      body: { error: { code: "no_simulated" } },
    });
    expect(model.requests).toHaveLength(0);
  });

  it("answers 401 to participants and other organizers", async () => {
    const m = await mixed("sim-auth", 1);
    const other = await seedDrafts(deps, "sim-auth-b", ["A", "B"], 1);
    expect((await simulate(m, m.participants[1]!.token)).status).toBe(401);
    expect((await simulate(m, other.organizerToken)).status).toBe(401);
  });
});
