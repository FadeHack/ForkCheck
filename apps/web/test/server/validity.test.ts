import { ScriptedProvider } from "@forkcheck/ai";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as organizerGet } from "../../src/app/api/meetings/[id]/route";
import { POST as openRoute } from "../../src/app/api/meetings/[id]/rounds/route";
import { GET as participantGet } from "../../src/app/api/p/[token]/route";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { POST as validityRoute } from "../../src/app/api/p/[token]/validity/route";
import { POST as closeRoute } from "../../src/app/api/rounds/[id]/close/route";
import type { OrganizerMeetingState, ParticipantState } from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { call, NOW, seedDrafts, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
  setDeps(createDeps(deps.db, { now: () => NOW, model: () => new ScriptedProvider({}) }));
});

/** Ana, Ben and Cy answer one question differently and the answers are revealed. */
async function revealed(id: string) {
  const m = await seedDrafts(deps, id, ["Ana", "Ben", "Cy"], 1);
  const probe = m.drafts[0]!;
  await call(
    openRoute,
    "/x",
    { id },
    { method: "POST", token: m.organizerToken, body: { probeIds: [probe.id] } },
  );
  for (const [who, k] of [0, 1, 1].entries()) {
    await call(
      answerRoute,
      "/x",
      { token: m.participants[who]!.token },
      {
        method: "POST",
        body: { probeId: probe.id, choice: "option", optionId: probe.options[k]!.id },
      },
    );
  }
  await call(
    closeRoute,
    "/x",
    { id: `${id}:round:0` },
    { method: "POST", token: m.organizerToken },
  );
  return { ...m, splitId: `${probe.id}:split` };
}

type Revealed = Awaited<ReturnType<typeof revealed>>;

const label = (m: Revealed, who: number, body: object) =>
  call(validityRoute, "/x", { token: m.participants[who]!.token }, { method: "POST", body });
const pid = (m: Revealed, who: number) => m.participants[who]!.participant.id;

describe("POST /api/p/:token/validity", () => {
  it("keeps one label per participant, changeable, and shows labels to everyone", async () => {
    const m = await revealed("val-1");
    expect(await label(m, 0, { splitId: m.splitId, label: "valid" })).toMatchObject({
      status: 200,
      body: { id: m.splitId, validity: [{ participantId: pid(m, 0), label: "valid" }] },
    });
    await label(m, 1, { splitId: m.splitId, label: "already_discussed" });
    const changed = await label(m, 0, { splitId: m.splitId, label: "doesnt_matter" });
    const expected = [
      { participantId: pid(m, 0), label: "doesnt_matter" },
      { participantId: pid(m, 1), label: "already_discussed" },
    ];
    expect(changed).toMatchObject({ status: 200, body: { validity: expected } });

    // Cy has not labeled and still sees both labels.
    const cy = (await call(participantGet, "/x", { token: m.participants[2]!.token }))
      .body as ParticipantState;
    expect(cy.revealed[0]!.split.validity).toEqual(expected);
    const state = (
      await call(organizerGet, "/x", { id: m.meeting.id }, { token: m.organizerToken })
    ).body as OrganizerMeetingState;
    expect(state.splits[0]!.validity).toEqual(expected);
  });

  it("keeps every label when participants submit at the same moment", async () => {
    const m = await revealed("val-race");
    const labels = ["valid", "redundant", "options_dont_differ"] as const;
    const res = await Promise.all(
      labels.map((l, who) => label(m, who, { splitId: m.splitId, label: l })),
    );
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    const stored = (await deps.splits.get(m.splitId))!.validity;
    expect(stored.toSorted((a, b) => a.label.localeCompare(b.label))).toEqual(
      labels
        .map((l, who) => ({ participantId: pid(m, who), label: l }))
        .toSorted((a, b) => a.label.localeCompare(b.label)),
    );
  });

  it("locks labels once resolution has started", async () => {
    const m = await revealed("val-lock");
    await label(m, 0, { splitId: m.splitId, label: "valid" });
    const split = (await deps.splits.get(m.splitId))!;
    await deps.splits.update({ ...split, status: "resolving" });
    expect(await label(m, 0, { splitId: m.splitId, label: "redundant" })).toMatchObject({
      status: 409,
      body: { error: { code: "resolution_started" } },
    });
    expect(await label(m, 1, { splitId: m.splitId, label: "valid" })).toMatchObject({
      status: 409,
    });
    expect((await deps.splits.get(m.splitId))!.validity).toEqual([
      { participantId: pid(m, 0), label: "valid" },
    ]);
  });

  it("rejects unknown labels, unknown splits and another meeting's splits", async () => {
    const m = await revealed("val-bad");
    const other = await revealed("val-bad-b");
    expect((await label(m, 0, { splitId: m.splitId, label: "wrong" })).status).toBe(400);
    expect((await label(m, 0, { splitId: "nope", label: "valid" })).status).toBe(404);
    expect((await label(m, 0, { splitId: other.splitId, label: "valid" })).status).toBe(404);
    expect((await deps.splits.get(other.splitId))!.validity).toEqual([]);
    expect(
      (
        await call(
          validityRoute,
          "/x",
          { token: "not-a-token" },
          { method: "POST", body: { splitId: m.splitId, label: "valid" } },
        )
      ).status,
    ).toBe(401);
  });
});
