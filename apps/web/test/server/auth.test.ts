import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withOrganizer, withOrganizerOf, withParticipant } from "../../src/server/auth";
import type { Deps } from "../../src/server/deps";
import { json } from "../../src/server/http";
import { redact } from "../../src/server/log";
import { hashToken, newToken, tokenMatches } from "../../src/server/tokens";
import { call, seedMeeting, useTestDeps, type SeededMeeting } from "./harness";

const organizerRoute = withOrganizer<{ id: string }>(async (_req, { meeting }) =>
  json({ meetingId: meeting.id }),
);
const childRoute = withOrganizerOf<{ id: string }>(
  async (_deps, id) => (id.startsWith("child-of-") ? id.slice("child-of-".length) : null),
  async (_req, { meeting }) => json({ meetingId: meeting.id }),
);
const participantRoute = withParticipant<{ token: string }>(async (_req, { participant }) =>
  json({ participantId: participant.id }),
);
const throwingRoute = withParticipant<{ token: string }>(async (req) => {
  throw new Error(`boom at ${new URL(req.url).pathname}`);
});

let deps: Deps;
let a: SeededMeeting;
let b: SeededMeeting;

beforeAll(async () => {
  deps = await useTestDeps();
  a = await seedMeeting(deps, "ma");
  b = await seedMeeting(deps, "mb");
});

afterEach(() => vi.restoreAllMocks());

describe("tokens", () => {
  it("are 128-bit, URL-safe and distinct", () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(t, "base64url")).toHaveLength(16);
    }
  });

  it("are stored as SHA-256 hashes and matched against them", () => {
    const t = newToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(tokenMatches(t, hashToken(t))).toBe(true);
    expect(tokenMatches(newToken(), hashToken(t))).toBe(false);
    expect(tokenMatches(t, "not-hex")).toBe(false);
  });
});

describe("organizer routes", () => {
  const cases = [
    ["meeting route", organizerRoute, () => "ma"],
    ["child route", childRoute, () => "child-of-ma"],
  ] as const;

  for (const [name, route, id] of cases) {
    describe(name, () => {
      const path = () => `/api/x/${id()}`;

      it("accept the meeting's organizer token", async () => {
        const res = await call(route, path(), { id: id() }, { token: a.organizerToken });
        expect(res).toMatchObject({ status: 200, body: { meetingId: "ma" } });
      });

      it.each([
        ["a missing token", () => undefined],
        ["a wrong token", () => newToken()],
        ["a participant token", () => a.participants[0]!.token],
        ["another meeting's organizer token", () => b.organizerToken],
      ])("reject %s with 401 and no data", async (_label, token) => {
        const t = token();
        const res = await call(route, path(), { id: id() }, t === undefined ? {} : { token: t });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
      });
    });
  }

  it("answer 401, not 404, for an unknown meeting", async () => {
    const res = await call(
      organizerRoute,
      "/api/x/none",
      { id: "none" },
      { token: a.organizerToken },
    );
    expect(res.status).toBe(401);
  });

  it("reject a malformed Authorization header", async () => {
    const req = new Request("http://localhost/api/x/ma", {
      headers: { authorization: `Token ${a.organizerToken}` },
    });
    const res = await organizerRoute(req, { params: Promise.resolve({ id: "ma" }) });
    expect(res.status).toBe(401);
  });
});

describe("participant routes", () => {
  it("resolve the path token to its participant", async () => {
    const p = a.participants[1]!;
    const res = await call(participantRoute, `/api/p/${p.token}`, { token: p.token });
    expect(res).toMatchObject({ status: 200, body: { participantId: p.participant.id } });
  });

  it.each([
    ["a wrong token", () => newToken()],
    ["an organizer token", () => a.organizerToken],
    ["an empty token", () => ""],
  ])("reject %s with 401 and no data", async (_label, token) => {
    const t = token();
    const res = await call(participantRoute, `/api/p/${t}`, { token: t });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });
});

describe("headers and logs", () => {
  it("send no-referrer and no-store on success and on 401", async () => {
    const p = a.participants[0]!;
    for (const res of [
      await call(participantRoute, `/api/p/${p.token}`, { token: p.token }),
      await call(participantRoute, "/api/p/x", { token: "x" }),
      await call(organizerRoute, "/api/x/ma", { id: "ma" }),
    ]) {
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never write a token to the log", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const p = a.participants[0]!;
    const res = await call(throwingRoute, `/api/p/${p.token}/answers`, { token: p.token });
    expect(res.status).toBe(500);
    await call(organizerRoute, "/api/x/ma", { id: "ma" }, { token: newToken() });
    await call(participantRoute, `/api/p/${a.organizerToken}`, { token: a.organizerToken });

    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join("\n");
    for (const t of [p.token, a.organizerToken]) expect(logged).not.toContain(t);
    expect(logged).toContain("/api/p/[token]/answers");
  });

  it("redact tokens in paths and bearer headers", () => {
    expect(redact("GET /p/abc123?x=1 and /api/p/def/answers")).toBe(
      "GET /p/[token]?x=1 and /api/p/[token]/answers",
    );
    expect(redact("authorization: Bearer s3cret")).toBe("authorization: Bearer [token]");
  });
});
