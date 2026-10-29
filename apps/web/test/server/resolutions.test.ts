import { ScriptedProvider } from "@forkcheck/ai";
import { beforeAll, describe, expect, it } from "vitest";
import { PATCH as participantPatch } from "../../src/app/api/meetings/[id]/participants/[pid]/route";
import { GET as participantGet } from "../../src/app/api/p/[token]/route";
import { POST as confirmRoute } from "../../src/app/api/p/[token]/resolutions/[rid]/confirm/route";
import { POST as resolutionsRoute } from "../../src/app/api/p/[token]/resolutions/route";
import { POST as unresolvedRoute } from "../../src/app/api/p/[token]/splits/[id]/unresolved/route";
import { POST as validityRoute } from "../../src/app/api/p/[token]/validity/route";
import type {
  ConfirmResolutionResponse,
  DraftResolutionResponse,
  ParticipantState,
  ProposeResolutionResponse,
} from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { call, NOW, seedRevealed, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

type Revealed = Awaited<ReturnType<typeof seedRevealed>>;
const ANA = 0;
const BEN = 1;
const CY = 2;

const token = (m: Revealed, who: number) => m.participants[who]!.token;
const pid = (m: Revealed, who: number) => m.participants[who]!.participant.id;

const propose = (m: Revealed, who: number, text: string) =>
  call(
    resolutionsRoute,
    "/x",
    { token: token(m, who) },
    { method: "POST", body: { splitId: m.splitId, text } },
  );
const confirm = (m: Revealed, who: number, rid: string) =>
  call(confirmRoute, "/x", { token: token(m, who), rid }, { method: "POST" });
const markStatus = (m: Revealed, who: number, status: "active" | "absent") =>
  call(
    participantPatch,
    "/x",
    { id: m.meeting.id, pid: pid(m, who) },
    { method: "PATCH", token: m.organizerToken, body: { status } },
  );
const splitStatus = async (m: Revealed) => (await deps.splits.get(m.splitId))!.status;

describe("resolutions", () => {
  it("returns a model draft labeled as such and saves nothing", async () => {
    const m = await seedRevealed(deps, "res-draft");
    const model = new ScriptedProvider({
      draftResolution: [{ text: "SSO runs on [staging / production] on Friday." }],
    });
    setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
    const res = await call(
      resolutionsRoute,
      "/x?draft=1",
      { token: token(m, ANA) },
      { method: "POST", body: { splitId: m.splitId } },
    );
    expect(res.status).toBe(200);
    expect(res.body as DraftResolutionResponse).toEqual({
      text: "SSO runs on [staging / production] on Friday.",
      draftedByModel: true,
    });
    expect(model.requests).toHaveLength(1);
    expect(await deps.splits.resolutions([m.splitId])).toEqual([]);
    expect(await splitStatus(m)).toBe("open");
    // Still open: labels can change, which they can't once a proposal exists.
    const label = await call(
      validityRoute,
      "/x",
      { token: token(m, BEN) },
      { method: "POST", body: { splitId: m.splitId, label: "valid" } },
    );
    expect(label.status).toBe(200);
  });

  it("confirms only once every active participant has, and names the absent", async () => {
    const m = await seedRevealed(deps, "res-confirm");
    const proposed = await propose(m, ANA, "We run SSO on staging first, then production.");
    expect(proposed.status).toBe(201);
    const resolution = proposed.body as ProposeResolutionResponse;
    expect(resolution).toMatchObject({
      proposedBy: pid(m, ANA),
      draftedByModel: false,
      status: "proposed",
    });
    expect(await splitStatus(m)).toBe("resolving");

    const ana = (await confirm(m, ANA, resolution.id)).body as ConfirmResolutionResponse;
    expect(ana).toMatchObject({ confirmedBy: [pid(m, ANA)], absent: [] });
    expect(ana.pending.toSorted()).toEqual([pid(m, BEN), pid(m, CY)].toSorted());
    await confirm(m, BEN, resolution.id);
    expect(await splitStatus(m)).toBe("resolving");

    // Cy leaves: the two who are present have both confirmed.
    expect((await markStatus(m, CY, "absent")).status).toBe(200);
    expect(await splitStatus(m)).toBe("confirmed");
    const again = (await confirm(m, BEN, resolution.id)).body as ConfirmResolutionResponse;
    expect(again).toMatchObject({
      resolution: { id: resolution.id, status: "confirmed" },
      pending: [],
      absent: [pid(m, CY)],
    });
    expect(again.confirmedBy.toSorted()).toEqual([pid(m, ANA), pid(m, BEN)].toSorted());

    // Marking Cy present again would leave a confirmed split with an unconfirmed member.
    expect(await markStatus(m, CY, "active")).toMatchObject({
      status: 409,
      body: { error: { code: "would_break_confirmation" } },
    });
    const cy = (await call(participantGet, "/x", { token: token(m, CY) })).body as ParticipantState;
    expect(cy.participant.status).toBe("absent");
    expect(await confirm(m, CY, resolution.id)).toMatchObject({ status: 409 });
  });

  it("does not wait for someone already absent, and refuses their actions", async () => {
    const m = await seedRevealed(deps, "res-absent");
    await markStatus(m, CY, "absent");
    expect(await propose(m, CY, "Staging first.")).toMatchObject({
      status: 409,
      body: { error: { code: "participant_absent" } },
    });
    const { id } = (await propose(m, BEN, "Staging first.")).body as ProposeResolutionResponse;
    await confirm(m, ANA, id);
    const last = (await confirm(m, BEN, id)).body as ConfirmResolutionResponse;
    expect(last).toMatchObject({ pending: [], absent: [pid(m, CY)] });
    expect(await splitStatus(m)).toBe("confirmed");
  });

  it("supersedes the earlier proposal and its confirmations on a new one", async () => {
    const m = await seedRevealed(deps, "res-supersede");
    const first = (await propose(m, ANA, "Staging first.")).body as ProposeResolutionResponse;
    await confirm(m, ANA, first.id);
    await confirm(m, BEN, first.id);
    const second = (await propose(m, CY, "Production first, staging after."))
      .body as ProposeResolutionResponse;
    expect(second.id).not.toBe(first.id);

    const all = await deps.splits.resolutions([m.splitId]);
    expect(all.map((r) => [r.id, r.status])).toEqual([
      [first.id, "superseded"],
      [second.id, "proposed"],
    ]);
    expect(await confirm(m, CY, first.id)).toMatchObject({
      status: 409,
      body: { error: { code: "resolution_superseded" } },
    });
    const ana = (await confirm(m, ANA, second.id)).body as ConfirmResolutionResponse;
    expect(ana.confirmedBy).toEqual([pid(m, ANA)]);
    expect(ana.pending.toSorted()).toEqual([pid(m, BEN), pid(m, CY)].toSorted());
    expect(await splitStatus(m)).toBe("resolving");
  });

  it("treats a repeated confirmation as one", async () => {
    const m = await seedRevealed(deps, "res-idem");
    const { id } = (await propose(m, ANA, "Staging first.")).body as ProposeResolutionResponse;
    const once = await confirm(m, BEN, id);
    const twice = await confirm(m, BEN, id);
    expect(twice).toEqual(once);
    expect(await deps.splits.confirmations([id])).toHaveLength(1);
  });

  it("applies simultaneous proposals and confirmations one at a time", async () => {
    const m = await seedRevealed(deps, "res-race");
    const both = await Promise.all([propose(m, ANA, "Staging."), propose(m, BEN, "Production.")]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    const all = await deps.splits.resolutions([m.splitId]);
    expect(all.map((r) => r.status)).toEqual(["superseded", "proposed"]);

    const current = all[1]!.id;
    await Promise.all([ANA, BEN, CY].map((who) => confirm(m, who, current)));
    expect(await splitStatus(m)).toBe("confirmed");
    expect(await deps.splits.confirmations([current])).toHaveLength(3);
  });

  it("agrees to disagree, after which the split takes no proposals or confirmations", async () => {
    const m = await seedRevealed(deps, "res-unresolved");
    const { id } = (await propose(m, ANA, "Staging first.")).body as ProposeResolutionResponse;
    const res = await call(
      unresolvedRoute,
      "/x",
      { token: token(m, BEN), id: m.splitId },
      { method: "POST" },
    );
    expect(res).toMatchObject({ status: 200, body: { id: m.splitId, status: "unresolved" } });
    expect((await deps.splits.resolutions([m.splitId]))[0]!.status).toBe("superseded");
    expect(await propose(m, CY, "Production.")).toMatchObject({
      status: 409,
      body: { error: { code: "invalid_transition" } },
    });
    expect((await confirm(m, CY, id)).status).toBe(409);
  });

  it("answers 404 for other meetings' splits and resolutions, and 401 for bad tokens", async () => {
    const m = await seedRevealed(deps, "res-scope");
    const other = await seedRevealed(deps, "res-scope-b");
    const theirs = (await propose(other, ANA, "Staging.")).body as ProposeResolutionResponse;
    expect((await propose({ ...m, splitId: other.splitId }, ANA, "Mine.")).status).toBe(404);
    expect((await confirm(m, ANA, theirs.id)).status).toBe(404);
    expect((await confirm(m, ANA, "nope")).status).toBe(404);
    const unresolved = await call(
      unresolvedRoute,
      "/x",
      { token: token(m, ANA), id: other.splitId },
      { method: "POST" },
    );
    expect(unresolved.status).toBe(404);
    expect(await deps.splits.resolutions([other.splitId])).toHaveLength(1);
    expect(
      (
        await call(
          resolutionsRoute,
          "/x",
          { token: "not-a-token" },
          { method: "POST", body: { splitId: m.splitId, text: "x" } },
        )
      ).status,
    ).toBe(401);
  });
});
