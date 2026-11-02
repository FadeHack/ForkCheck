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

export function tooManyRequests(retryAfterS: number): Response {
  const body: ApiError = {
    error: { code: "rate_limited", message: "Too many requests. Wait a minute and try again." },
  };
  return Response.json(body, {
    status: 429,
    headers: { ...tokenRouteHeaders, "Retry-After": String(retryAfterS) },
  });
}

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

/** JSON bodies are small except a pasted transcript; 256 KB holds hours of meeting talk. */
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_TRANSCRIPT_BODY_BYTES = 256 * 1024;

const tooLarge = (maxBytes: number): Response =>
  apiError(413, "too_large", `The request is over the ${Math.round(maxBytes / 1024)} KB limit.`);

/** The body as text, or null once it passes `maxBytes`; stops reading at that point. */
async function readCapped(req: Request, maxBytes: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parses the JSON body against a contract schema, or returns the 400 or 413 to send. */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const text = await readCapped(req, maxBytes);
  if (text === null) return { ok: false, response: tooLarge(maxBytes) };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
