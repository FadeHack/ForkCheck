import type { ModelPort } from "@forkcheck/ai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as analyzeRoute } from "../../src/app/api/meetings/[id]/analyze/route";
import { GET as organizerRoute } from "../../src/app/api/meetings/[id]/route";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { POST as answerRoute } from "../../src/app/api/p/[token]/answers/route";
import { GET as participantRoute } from "../../src/app/api/p/[token]/route";
import { guarded } from "../../src/server/auth";
import type { Deps } from "../../src/server/deps";
import { MAX_BODY_BYTES, MAX_TRANSCRIPT_BODY_BYTES } from "../../src/server/http";
import { redact } from "../../src/server/log";
import { defaultRateLimits } from "../../src/server/rate-limit";
import { securityHeaders, tokenPathHeaders } from "../../src/server/security-headers";
import { NOW, seedMeeting, useTestDeps } from "./harness";

let clock = NOW;
// Fake keys are assembled at runtime so the secret scanner doesn't flag the source.
const KEY = ["LLM", "1234567890", "abcdefghijklmnopqrstuvwxyz"].join("_");
const BASETEN_KEY = ["bt", "0123456789"].join("-");
let failWith: string | null = null;
const failing: ModelPort = {
  call: () => Promise.reject(new Error(failWith ?? "model down")),
};

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps({ now: () => clock, model: () => failing });
});
beforeEach(() => {
  clock = NOW;
  deps.rateLimits = defaultRateLimits(() => clock);
});

const at = (path: string, init: RequestInit & { ip?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.ip) headers.set("x-forwarded-for", init.ip);
  return new Request(`http://localhost${path}`, { ...init, headers });
};
const params = <P>(p: P) => ({ params: Promise.resolve(p) });

const createBody = (transcriptChars: number) =>
  JSON.stringify({
    title: "Size check",
    heldAt: "2026-10-27T15:00:00-04:00",
    timezone: "America/New_York",
    participants: ["Ana", "Ben"],
    transcript: `Ana: ${"x".repeat(transcriptChars)}`,
  });

/** A body with no Content-Length, so the cap has to stop the stream itself. */
const streamed = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.slice(i, i + 4096));
      c.close();
    },
  });

describe("request size limits", () => {
  it("accepts a long pasted transcript and refuses one over the limit", async () => {
    const ok = await createRoute(
      at("/api/meetings", { method: "POST", body: createBody(100_000) }),
    );
    expect(ok.status).toBe(201);

    const big = await createRoute(
      at("/api/meetings", { method: "POST", body: createBody(MAX_TRANSCRIPT_BODY_BYTES) }),
    );
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: { code: string } }).error.code).toBe("too_large");
  });

  it("stops reading a streamed body without a length once it passes the limit", async () => {
    const res = await createRoute(
      at("/api/meetings", {
        method: "POST",
        body: streamed(createBody(MAX_TRANSCRIPT_BODY_BYTES)),
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it("caps every other JSON route at the small limit", async () => {
    const m = await seedMeeting(deps, "size-small");
    const token = m.participants[0]!.token;
    const body = JSON.stringify({
      probeId: "x",
      choice: "write_in",
      writeIn: "y".repeat(MAX_BODY_BYTES),
    });
    const res = await answerRoute(
      at(`/api/p/${token}/answers`, { method: "POST", body }),
      params({ token }),
    );
    expect(res.status).toBe(413);
  });
});

describe("rate limits", () => {
  it("limits requests per participant link and resets after a minute", async () => {
    const m = await seedMeeting(deps, "rate-link");
    const [a, b] = m.participants.map((p) => p.token);
    const get = (token: string) => participantRoute(at(`/api/p/${token}`), params({ token }));
    for (let i = 0; i < 120; i++) expect((await get(a!)).status).toBe(200);
    const limited = await get(a!);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another person's link is unaffected.
    expect((await get(b!)).status).toBe(200);

    clock = new Date(NOW.getTime() + 60_000);
    expect((await get(a!)).status).toBe(200);
  });

  it("blocks a client after repeated wrong tokens, even with a right one, but not others", async () => {
    const m = await seedMeeting(deps, "rate-guess");
    const real = m.participants[0]!.token;
    const get = (token: string, ip: string) =>
      participantRoute(at(`/api/p/${token}`, { ip }), params({ token }));
    for (let i = 0; i < 30; i++) expect((await get(`guess-${i}`, "203.0.113.7")).status).toBe(401);
    expect((await get(real, "203.0.113.7")).status).toBe(429);
    expect((await get(real, "198.51.100.2")).status).toBe(200);

    // Wrong organizer tokens count toward the same limit.
    const organizer = await organizerRoute(
      at(`/api/meetings/${m.meeting.id}`, {
        ip: "203.0.113.7",
        headers: { authorization: `Bearer ${m.organizerToken}` },
      }),
      params({ id: m.meeting.id }),
    );
    expect(organizer.status).toBe(429);
  });
});

describe("errors never echo tokens or keys", () => {
  let logged: string[];
  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    failWith = null;
  });

  it("keeps a failing model's message, key included, out of the response and the log", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    const created = await createRoute(
      at("/api/meetings", { method: "POST", body: createBody(200) }),
    );
    const m = (await created.json()) as { meetingId: string; organizerToken: string };
    failWith = `401 from upstream: key ${KEY} rejected for Bearer ${m.organizerToken}`;
    const res = await analyzeRoute(
      at(`/api/meetings/${m.meetingId}/analyze`, {
        method: "POST",
        headers: { authorization: `Bearer ${m.organizerToken}` },
      }),
      params({ id: m.meetingId }),
    );
    expect(res.status).toBe(502);
    expect(logged.length).toBeGreaterThan(0);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(m.organizerToken);
    for (const line of logged) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(m.organizerToken);
    }
    vi.unstubAllEnvs();
  });

  it("answers an unexpected error with a fixed message and logs it redacted", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    const token = "tok_secret_participant_value";
    const res = await guarded(at(`/api/p/${token}/answers`, { method: "POST" }), () => {
      throw new Error(`failed for /api/p/${token} with ${KEY}`);
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain(KEY);
    expect(logged.join("\n")).not.toContain(token);
    expect(logged.join("\n")).not.toContain(KEY);
    expect(logged.join("\n")).toContain("[token]");
    vi.unstubAllEnvs();
  });

  it("does not repeat a wrong token in a 401", async () => {
    const token = "not-a-real-token-value-123";
    const res = await participantRoute(at(`/api/p/${token}`), params({ token }));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(token);
  });

  it("redacts keys of any shape once they are configured", () => {
    vi.stubEnv("BASETEN_API_KEY", BASETEN_KEY);
    expect(redact(`auth ${BASETEN_KEY} failed`)).toBe("auth [key] failed");
    expect(redact(`key ${KEY}`)).toBe("key [key]");
    vi.unstubAllEnvs();
  });
});

describe("security headers", () => {
  const byKey = (dev: boolean) => new Map(securityHeaders(dev).map((h) => [h.key, h.value]));

  it("sets the headers every response gets", () => {
    const h = byKey(false);
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(h.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(h.get("Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(byKey(true).get("Content-Security-Policy")).toContain("unsafe-eval");
  });

  it("keeps participant pages free of referrers and caches", () => {
    const h = new Map(tokenPathHeaders.map((x) => [x.key, x.value]));
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("Cache-Control")).toBe("no-store");
  });
});
