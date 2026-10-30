import type { Candidate, Dimension, Meeting, Participant, Probe } from "@forkcheck/core";
import { createMemoryDb } from "@forkcheck/db/testing";
import { afterAll, afterEach } from "vitest";
import { POST as openRoute } from "../../src/app/api/meetings/[id]/rounds/route";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { POST as closeRoute } from "../../src/app/api/rounds/[id]/close/route";
import { createDeps, setDeps, type Deps, type DepsOverrides } from "../../src/server/deps";
import { hashToken, newToken } from "../../src/server/tokens";

export const NOW = new Date("2026-10-27T20:00:00.000Z");

/** A PGlite database behind the route handlers, for one test file. */
export async function useTestDeps(overrides: DepsOverrides = {}): Promise<Deps> {
  const { db, close } = await createMemoryDb();
  const deps = createDeps(db, { now: () => NOW, ...overrides });
  setDeps(deps);
  afterEach(() => setDeps(deps));
  afterAll(async () => {
    setDeps(undefined);
    await close();
  });
  return deps;
}

export interface SeededMeeting {
  meeting: Meeting;
  organizerToken: string;
  participants: { participant: Participant; token: string }[];
}

/** A name, or a simulated participant with the notes the simulator answers from. */
export type SeedName = string | { name: string; notes: string };

/** A meeting written straight through the repository, with known tokens. */
export async function seedMeeting(
  deps: Deps,
  id: string,
  names: SeedName[] = ["Ana", "Ben"],
): Promise<SeededMeeting> {
  const meeting: Meeting = {
    id,
    title: `Meeting ${id}`,
    source: "paste",
    status: "draft",
    heldAt: "2026-10-27T15:00:00.000Z",
    timezone: "America/New_York",
    transcriptVersion: 1,
    error: null,
    createdAt: NOW.toISOString(),
    deleteAfter: null,
  };
  const organizerToken = newToken();
  const notes = names.map((name) => (typeof name === "string" ? undefined : name.notes));
  const participants = names.map((name, i) => ({
    participant: {
      id: `${id}:p:${i}`,
      meetingId: id,
      displayName: typeof name === "string" ? name : name.name,
      isSimulated: typeof name !== "string",
      status: "active" as const,
    },
    token: newToken(),
  }));
  await deps.meetings.create({
    meeting,
    organizerTokenHash: hashToken(organizerToken),
    participants: participants.map((p, i) => ({
      participant: p.participant,
      tokenHash: hashToken(p.token),
      simulatorNotes: notes[i],
    })),
    segments: [],
  });
  return { meeting, organizerToken, participants };
}

const DIMENSIONS: Dimension[] = ["owner", "deadline", "scope", "criteria", "dependency", "outcome"];

/**
 * A meeting after analysis: one decision, and `count` lint-clean draft questions with two
 * options each, ranked in ID order. Status is `probing`.
 */
export async function seedDrafts(
  deps: Deps,
  id: string,
  names: SeedName[] = ["Ana", "Ben"],
  count = 3,
): Promise<SeededMeeting & { drafts: Probe[] }> {
  const seeded = await seedMeeting(deps, id, names);
  const decisionId = `${id}:dec:0`;
  const candidates: Candidate[] = Array.from({ length: count }, (_, k) => ({
    id: `${id}:cand:${k}`,
    decisionId,
    dimension: DIMENSIONS[k % DIMENSIONS.length]!,
    readings: [
      { id: `${id}:cand:${k}:r:0`, text: "staging" },
      { id: `${id}:cand:${k}:r:1`, text: "production" },
    ],
    impact: { reversibility: "medium", blastRadius: "high", timeToImpact: "high" },
  }));
  const drafts: Probe[] = candidates.map((c, k) => ({
    id: `${c.id}:probe:0`,
    meetingId: id,
    kind: "diagnostic",
    candidateId: c.id,
    splitId: null,
    tier: "template",
    stem: `Question ${k}: where does SSO run on Friday?`,
    options: [
      { id: `${c.id}:probe:0:opt:0`, text: "On staging" },
      { id: `${c.id}:probe:0:opt:1`, text: "In production" },
    ],
    lint: [],
    promptVersion: "template.v1",
    status: "draft",
  }));
  await deps.meetings.saveAnalysis(id, {
    decisions: [
      {
        decision: {
          id: decisionId,
          meetingId: id,
          idx: 0,
          kind: "decision",
          statement: "Ship SSO on Friday",
          ownerText: null,
          deadlineText: "Friday",
          ownerInferred: false,
          deadlineInferred: false,
          status: "ambiguous",
        },
        evidence: [],
      },
    ],
    candidates,
    probes: drafts,
  });
  return { ...seeded, meeting: { ...seeded.meeting, status: "probing" }, drafts };
}

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

export interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

/** Calls a route handler the way Next does, with an optional organizer bearer token. */
export async function call<P>(
  handler: Handler<P>,
  path: string,
  params: P,
  options: CallOptions = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const headers = new Headers();
  if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const req = new Request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === "" ? null : JSON.parse(text) };
}

/** Ana, Ben and Cy answer one question differently and the answers are revealed. */
export async function seedRevealed(
  deps: Deps,
  id: string,
  names: SeedName[] = ["Ana", "Ben", "Cy"],
) {
  const m = await seedDrafts(deps, id, names, 1);
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
