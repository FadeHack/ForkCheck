import type { ApiError } from "../contracts/api";

/** Sent on every API response: token URLs must not leak through Referer or caches. */
export const tokenRouteHeaders = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
} as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: tokenRouteHeaders });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: tokenRouteHeaders });
}

export function apiError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return json(body, status);
}

export const unauthorized = (): Response =>
  apiError(
    401,
    "unauthorized",
    "This link or token is not valid. Ask the organizer for a new link.",
  );
