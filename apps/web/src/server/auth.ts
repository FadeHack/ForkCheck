import type { Meeting, Participant } from "@forkcheck/core";
import { getDeps, type Deps } from "./deps";
import { apiError, tooManyRequests, unauthorized } from "./http";
import { logError } from "./log";
import { clientKey } from "./rate-limit";
import { hashToken, tokenMatches } from "./tokens";

type Params = Record<string, string>;
interface RouteContext<P extends Params> {
  params: Promise<P>;
}

export interface OrganizerContext<P extends Params> {
  deps: Deps;
  meeting: Meeting;
  params: P;
}

export interface ParticipantContext<P extends Params> {
  deps: Deps;
  participant: Participant;
  meeting: Meeting;
  params: P;
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

/** A 401 that counts toward the client's failed-lookup limit. */
function refuse(deps: Deps, client: string): Response {
  deps.rateLimits.failedAuth.take(client);
  return unauthorized();
}

export async function guarded(req: Request, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    logError(`${req.method} ${new URL(req.url).pathname}`, error);
    return apiError(500, "internal", "Something went wrong on the server. Try again.");
  }
}

/** Organizer routes keyed by a child ID; `meetingOf` finds the owning meeting. */
export function withOrganizerOf<P extends Params & { id: string }>(
  meetingOf: (deps: Deps, id: string) => Promise<string | null>,
  handler: (req: Request, ctx: OrganizerContext<P>) => Promise<Response>,
) {
  return (req: Request, route: RouteContext<P>): Promise<Response> =>
    guarded(req, async () => {
      const deps = getDeps();
      const params = await route.params;
      const client = clientKey(req);
      const blocked = deps.rateLimits.failedAuth.blocked(client);
      if (!blocked.ok) return tooManyRequests(blocked.retryAfterS);
      const token = bearerToken(req);
      if (token === null) return refuse(deps, client);
      const meetingId = await meetingOf(deps, params.id);
      const stored = meetingId === null ? null : await deps.meetings.organizerTokenHash(meetingId);
      // Unknown IDs answer 401, not 404, so they cannot be probed without a token.
      if (meetingId === null || stored === null || !tokenMatches(token, stored)) {
        return refuse(deps, client);
      }
      const meeting = await deps.meetings.get(meetingId);
      if (meeting === null) return refuse(deps, client);
      return handler(req, { deps, meeting, params });
    });
}

/**
 * Organizer routes scoped to one meeting (`/api/meetings/:id/...`). The token must belong
 * to that meeting; any other token, including a participant's, gets the same 401.
 */
export function withOrganizer<P extends Params & { id: string }>(
  handler: (req: Request, ctx: OrganizerContext<P>) => Promise<Response>,
) {
  return withOrganizerOf<P>(async (_deps, id) => id, handler);
}

/** Participant routes (`/api/p/:token/...`): the path token is the credential. */
export function withParticipant<P extends Params & { token: string }>(
  handler: (req: Request, ctx: ParticipantContext<P>) => Promise<Response>,
) {
  return (req: Request, route: RouteContext<P>): Promise<Response> =>
    guarded(req, async () => {
      const deps = getDeps();
      const params = await route.params;
      const client = clientKey(req);
      const blocked = deps.rateLimits.failedAuth.blocked(client);
      if (!blocked.ok) return tooManyRequests(blocked.retryAfterS);
      // A lookup by SHA-256 digest: timing reveals nothing about the token itself.
      const digest = hashToken(params.token);
      const participant = await deps.meetings.findParticipantByTokenHash(digest);
      if (participant === null) return refuse(deps, client);
      const meeting = await deps.meetings.get(participant.meetingId);
      if (meeting === null) return refuse(deps, client);
      const allowed = deps.rateLimits.participant.take(digest);
      if (!allowed.ok) return tooManyRequests(allowed.retryAfterS);
      return handler(req, { deps, participant, meeting, params });
    });
}
