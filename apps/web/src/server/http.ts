import type { z } from "zod";
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

/** An ApiError with per-field messages, keyed by dotted path (`participants.1`). */
export interface ValidationError extends ApiError {
  error: ApiError["error"] & { fields: Record<string, string[]> };
}

export function invalidBody(fields: Record<string, string[]>): Response {
  const body: ValidationError = {
    error: { code: "invalid_body", message: "Some fields are missing or not valid.", fields },
  };
  return json(body, 400);
}

/** Parses the JSON body against a contract schema, or returns the 400 to send. */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: invalidBody({ "": ["The body must be JSON."] }) };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fields: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join(".");
    (fields[key] ??= []).push(issue.message);
  }
  return { ok: false, response: invalidBody(fields) };
}

export const notFound = (what: string): Response =>
  apiError(404, "not_found", `${what} was not found in this meeting.`);
