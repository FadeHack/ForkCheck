import type { ApiError } from "../contracts/api";

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; message: string; status: number | null }
  | { state: "ready"; data: T };

const OFFLINE = "ForkCheck couldn't reach the server. Check your connection and reload the page.";

function isApiError(body: unknown): body is ApiError {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ApiError).error?.message === "string"
  );
}

/** Calls an API route and returns the server's own message on failure; never throws. */
export async function callApi<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<
  { ok: true; data: T } | { ok: false; message: string; status: number | null; body: unknown }
> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      cache: "no-store",
      headers: {
        ...(rest.body === undefined ? {} : { "content-type": "application/json" }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...headers,
      },
    });
  } catch {
    return { ok: false, message: OFFLINE, status: null, body: null };
  }
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: body as T };
  const message = isApiError(body)
    ? body.error.message
    : `The server answered with status ${res.status}. Reload the page to try again.`;
  return { ok: false, message, status: res.status, body };
}

const tokenKey = (meetingId: string) => `forkcheck:organizer:${meetingId}`;

/**
 * The organizer token arrives in the URL fragment (`#k=`), which browsers never send to the
 * server. It is kept in sessionStorage so in-app navigation can drop the fragment.
 */
export function organizerToken(meetingId: string): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("k");
  try {
    if (fromHash) {
      window.sessionStorage.setItem(tokenKey(meetingId), fromHash);
      return fromHash;
    }
    return window.sessionStorage.getItem(tokenKey(meetingId));
  } catch {
    return fromHash;
  }
}

export function organizerUrl(meetingId: string, token: string): string {
  return `/m/${encodeURIComponent(meetingId)}#k=${encodeURIComponent(token)}`;
}
