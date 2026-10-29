import { expect, type APIRequestContext } from "@playwright/test";
import { ScriptedProvider } from "@forkcheck/ai";
import { loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { connect } from "@forkcheck/db";
import type {
  CreateMeetingResponse,
  OrganizerMeetingState,
  ParticipantState,
} from "../src/contracts/api";
import { analyzeMeeting } from "../src/server/analyze";
import { createDeps } from "../src/server/deps";
import { createMeeting } from "../src/server/meetings";

const transcript = [
  "[00:00] Priya: Where are we on single sign-on for the pilot customer?",
  "[00:06] Marco: Login works on staging. I still need to wire up the admin roles.",
  "[00:20] Priya: OK, so SSO is ready by Friday. Marco, that's yours?",
  "[00:25] Marco: Yep, I'll have it ready by Friday.",
  "[00:31] Dana: Great, I'll tell them Friday.",
].join("\n");

const low = { reversibility: "low", blastRadius: "low", timeToImpact: "low" };
const high = { reversibility: "high", blastRadius: "high", timeToImpact: "high" };

/** Model replies for one analysis run: two decisions, two open details, one question each. */
function script(meetingId: string) {
  const seg = (i: number) => `${meetingId}:seg:${i}`;
  return new ScriptedProvider({
    extract: [
      {
        decisions: [
          {
            kind: "commitment",
            statement: "Marco has single sign-on ready by Friday.",
            ownerText: "Marco",
            deadlineText: "by Friday",
            status: "ambiguous",
            evidence: [{ segmentId: seg(3), quote: "I'll have it ready by Friday." }],
          },
          {
            kind: "commitment",
            statement: "Dana tells the customer it will be Friday.",
            ownerText: "Dana",
            deadlineText: null,
            status: "explicit",
            evidence: [{ segmentId: seg(4), quote: "I'll tell them Friday." }],
          },
        ],
      },
    ],
    findCandidates: [
      {
        candidates: [
          {
            decisionId: `${meetingId}:dec:0`,
            dimension: "scope",
            readings: [{ text: "running on staging" }, { text: "live in production" }],
            impact: high,
          },
          {
            decisionId: `${meetingId}:dec:1`,
            dimension: "outcome",
            readings: [{ text: "the customer can start testing" }, { text: "a date only" }],
            impact: low,
          },
        ],
      },
    ],
    generateProbes: [
      {
        probes: [
          {
            stem: "Where does single sign-on run on Friday?",
            options: [{ text: "On staging only" }, { text: "In production" }],
          },
        ],
      },
      {
        probes: [
          {
            stem: "What can the customer do once Dana tells them Friday?",
            options: [{ text: "Start testing sign-in" }, { text: "Plan around the date" }],
          },
        ],
      },
    ],
    critique: [
      { canDiverge: true, leadingOption: null, reason: "Staging and production differ." },
      { canDiverge: true, leadingOption: null, reason: "Testing and planning differ." },
    ],
  });
}

/** A pasted meeting with drafted questions, written through the app's own server code. */
export async function seedAnalyzedMeeting(origin: string): Promise<CreateMeetingResponse> {
  loadLocalEnvFile();
  const env = loadEnv(process.env, { require: ["DATABASE_URL"] });
  const { db, close } = connect(env.DATABASE_URL!);
  try {
    const plain = createDeps(db);
    const created = await createMeeting(
      plain,
      {
        title: "Pilot customer check-in",
        heldAt: "2026-10-26T15:00:00-04:00",
        timezone: "America/New_York",
        participants: ["Priya", "Marco", "Dana"],
        transcript,
      },
      origin,
    );
    const deps = createDeps(db, { model: () => script(created.meetingId) });
    const meeting = (await deps.meetings.get(created.meetingId))!;
    const outcome = await analyzeMeeting(deps, meeting);
    if (!outcome.ok) throw new Error(`seed analysis failed: ${outcome.message}`);
    return created;
  } finally {
    await close();
  }
}

/** Publishes every draft, as the organizer's "Publish" button would. */
export async function openRound(request: APIRequestContext, meetingId: string, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  const res = await request.get(`/api/meetings/${meetingId}`, { headers });
  const state = (await res.json()) as OrganizerMeetingState;
  const probeIds = state.probes.filter((p) => p.status === "draft").map((p) => p.id);
  const opened = await request.post(`/api/meetings/${meetingId}/rounds`, {
    headers,
    data: { probeIds },
  });
  expect(opened.ok()).toBe(true);
}

/** Reveals the open round, as the organizer's "Reveal answers" button would. */
export async function closeRound(request: APIRequestContext, meetingId: string, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  const state = (await (
    await request.get(`/api/meetings/${meetingId}`, { headers })
  ).json()) as OrganizerMeetingState;
  const round = state.rounds.find((r) => r.closedAt === null)!;
  const closed = await request.post(`/api/rounds/${round.id}/close`, { headers });
  expect(closed.ok()).toBe(true);
}

/**
 * Answers open questions through the participant API. `pick` returns the option text to choose
 * for a question's stem, `null` for its first option, or `undefined` to leave it unanswered.
 */
export async function answerOpen(
  request: APIRequestContext,
  token: string,
  pick: (stem: string) => string | null | undefined,
) {
  const res = await request.get(`/api/p/${token}`);
  const { openProbes } = (await res.json()) as ParticipantState;
  for (const probe of openProbes) {
    const text = pick(probe.stem);
    if (text === undefined) continue;
    const option = probe.options.find((o) => o.text === text) ?? probe.options[0]!;
    const sent = await request.post(`/api/p/${token}/answers`, {
      data: { probeId: probe.id, choice: "option", optionId: option.id },
    });
    expect(sent.ok()).toBe(true);
  }
}
