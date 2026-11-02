import { ScriptedProvider } from "@forkcheck/ai";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { GET } from "../../src/app/api/meetings/[id]/route";
import { POST as analyzeRoute } from "../../src/app/api/meetings/[id]/analyze/route";
import type { CreateMeetingResponse, OrganizerMeetingState } from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { call, NOW, useTestDeps } from "./harness";

/** M8.4: with the setting on, no participant name reaches the model. */
const names = ["Priya Shah", "Marco", "Dana"];
const transcript = [
  "[00:00] Priya Shah: Where are we on single sign-on for the pilot customer?",
  "[00:06] Marco: Yep, I'll have it ready by Friday. Priya, I'll ping you.",
  "[00:12] Dana: Then the launch email goes out after that.",
].join("\n");

const impact = { reversibility: "medium", blastRadius: "high", timeToImpact: "high" };

/**
 * Replies in the placeholders the model sees. Letters follow the participant list, which is
 * alphabetical: Dana is Person A, Marco Person B, Priya Shah Person C Surname C.
 */
function script(meetingId: string) {
  return new ScriptedProvider({
    extract: [
      {
        decisions: [
          {
            kind: "commitment",
            statement: "Person B has SSO ready by Friday and tells Person C.",
            ownerText: "Person B",
            deadlineText: "by Friday",
            status: "ambiguous",
            evidence: [{ segmentId: `${meetingId}:seg:1`, quote: "Person C, I'll ping you." }],
          },
        ],
      },
    ],
    findCandidates: [
      {
        candidates: [
          {
            decisionId: `${meetingId}:dec:0`,
            dimension: "outcome",
            readings: [{ text: "Person C can log in" }, { text: "every user can log in" }],
            impact,
          },
        ],
      },
    ],
    generateProbes: [
      {
        probes: [
          {
            stem: "Who can sign in once Person B calls SSO ready?",
            options: [{ text: "Only Person C Surname C" }, { text: "Every customer user" }],
          },
        ],
      },
    ],
    critique: [{ canDiverge: true, leadingOption: null, reason: "Each reading names a group." }],
  });
}

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

async function analyzed(pseudonymizeNames: boolean | undefined) {
  const created = await call(
    createRoute,
    "/api/meetings",
    {},
    {
      method: "POST",
      body: {
        title: "SSO check-in",
        heldAt: "2026-10-26T15:00:00-04:00",
        timezone: "America/New_York",
        participants: names,
        transcript,
        ...(pseudonymizeNames === undefined ? {} : { pseudonymizeNames }),
      },
    },
  );
  const m = created.body as CreateMeetingResponse;
  const model = script(m.meetingId);
  setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
  const res = await call(
    analyzeRoute,
    "/x",
    { id: m.meetingId },
    {
      method: "POST",
      token: m.organizerToken,
    },
  );
  expect(res.status).toBe(200);
  const state = await call(GET, "/x", { id: m.meetingId }, { token: m.organizerToken });
  const sent = model.requests.flatMap((r) => r.messages.map((msg) => msg.content)).join("\n");
  return { state: state.body as OrganizerMeetingState, sent };
}

const named = (text: string, name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, "u").test(text);

describe("name pseudonymization", () => {
  it("sends no participant name in any model request", async () => {
    const { sent, state } = await analyzed(true);
    expect(state.meeting.pseudonymizeNames).toBe(true);
    expect(sent).toContain("Person C Surname C: Where are we");
    for (const name of ["Priya", "Shah", "Marco", "Dana"])
      expect(named(sent, name), name).toBe(false);
  });

  it("maps the replies back to names, and checks quotes against the original transcript", async () => {
    const { state } = await analyzed(true);
    const [decision] = state.decisions;
    expect(decision!.decision.statement).toBe("Marco has SSO ready by Friday and tells Priya.");
    expect(decision!.decision.ownerText).toBe("Marco");
    expect(decision!.evidence.map((e) => e.quote)).toEqual(["Priya, I'll ping you."]);
    expect(state.probes.map((p) => p.stem)).toEqual([
      "Who can sign in once Marco calls SSO ready?",
    ]);
    expect(state.probes[0]!.options.map((o) => o.text)).toContain("Only Priya Shah");
  });

  it("is off unless the organizer turns it on", async () => {
    const { sent, state } = await analyzed(undefined);
    expect(state.meeting.pseudonymizeNames).toBe(false);
    expect(sent).toContain("Priya Shah: Where are we");
  });
});
