import type { Meeting, Participant } from "@forkcheck/core";
import { createMemoryDb } from "@forkcheck/db/testing";
import { afterAll, afterEach } from "vitest";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { hashToken, newToken } from "../../src/server/tokens";

export const NOW = new Date("2026-10-27T20:00:00.000Z");

/** A PGlite database behind the route handlers, for one test file. */
export async function useTestDeps(): Promise<Deps> {
  const { db, close } = await createMemoryDb();
  const deps = createDeps(db, { now: () => NOW });
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

/** A meeting written straight through the repository, with known tokens. */
export async function seedMeeting(
  deps: Deps,
  id: string,
  names = ["Ana", "Ben"],
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
  const participants = names.map((displayName, i) => ({
    participant: {
      id: `${id}:p:${i}`,
      meetingId: id,
      displayName,
      isSimulated: false,
      status: "active" as const,
    },
    token: newToken(),
  }));
  await deps.meetings.create({
    meeting,
    organizerTokenHash: hashToken(organizerToken),
    participants: participants.map((p) => ({
      participant: p.participant,
      tokenHash: hashToken(p.token),
    })),
    segments: [],
  });
  return { meeting, organizerToken, participants };
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
