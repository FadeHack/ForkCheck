import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  normalizeQuote,
  parseTranscript,
  probeQuote,
  suggestNearMatches,
  verifyQuote,
  type QuoteSources,
} from "../src/index";

const seg = (text: string) => ({ text });

describe("verifyQuote", () => {
  it.each([
    ["exact", "SSO is ready by Friday.", "ready by Friday", "ready by Friday"],
    ["curly apostrophe in source", "Marco, that’s yours?", "that's yours", "that’s yours"],
    ["curly double quotes", "“done” means shipped", '"done" means', "“done” means"],
    ["em dash vs hyphen", "staging—not prod", "staging-not prod", "staging—not prod"],
    ["en dash range", "Mon–Wed", "Mon-Wed", "Mon–Wed"],
    ["whitespace runs and newline", "ready  by\nFriday", "ready by Friday", "ready  by\nFriday"],
    ["non-breaking space", "by Friday", "by Friday", "by Friday"],
    ["ellipsis", "well… maybe", "well... maybe", "well… maybe"],
    ["NFD quote, NFC source", "café launch", "café launch", "café launch"],
    ["NFC quote, NFD source", "café launch", "café", "café"],
    ["padding around quote", "ready by Friday", "  ready by Friday ", "ready by Friday"],
  ])("passes: %s", (_name, text, quote, matched) => {
    const m = verifyQuote(seg(text), quote);
    expect(m.ok).toBe(true);
    if (m.ok) expect(text.slice(m.start, m.end)).toBe(matched);
  });

  it.each([
    ["different word", "ready by Friday", "ready by Thursday"],
    ["case differs", "ready by Friday", "Ready by Friday"],
    ["extra word", "ready by Friday", "ready by this Friday"],
    ["dropped word", "I'll have it ready by Friday", "I'll have ready by Friday"],
    ["accent is semantic", "resume the work", "résumé"],
    ["spans two turns", "ready", "ready by Friday"],
  ])("fails: %s", (_name, text, quote) => {
    expect(verifyQuote(seg(text), quote)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an empty or blank quote", () => {
    expect(verifyQuote(seg("abc"), " \n ")).toEqual({ ok: false, reason: "empty_quote" });
  });

  it("rejects invented evidence and keeps typographic variants", () => {
    const { segments } = parseTranscript({
      meetingId: "m1",
      participants: [
        { id: "p", displayName: "Priya" },
        { id: "m", displayName: "Marco" },
      ],
      text: "Priya: OK, so SSO is ready by Friday. Marco, that’s yours?\nMarco: Yep, I’ll have it ready by Friday.",
    });
    const evidence = [
      { idx: 0, quote: "SSO is ready by Friday", real: true },
      { idx: 1, quote: "I'll have it ready by Friday", real: true },
      { idx: 1, quote: "I'll have it in production by Friday", real: false },
      { idx: 0, quote: "Marco owns SSO", real: false },
    ];
    for (const e of evidence) {
      const s = segments[e.idx];
      expect(s && verifyQuote(s, e.quote).ok).toBe(e.real);
    }
  });
});

describe("normalizeQuote", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (s) => normalizeQuote(normalizeQuote(s)) === normalizeQuote(s)),
    );
  });
});

describe("verifyQuote properties", () => {
  const piece = fc.oneof(
    fc.string({ unit: "grapheme", minLength: 1, maxLength: 1 }),
    fc.constantFrom("’", "“", "”", "—", "–", " ", "  ", "\n", " ", "…", "é", "é"),
  );

  it("verifies any substring of a segment", () => {
    fc.assert(
      fc.property(
        fc.array(piece, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        fc.nat(),
        (ps, a, b) => {
          const i = a % ps.length;
          const j = i + 1 + (b % (ps.length - i));
          const quote = ps.slice(i, j).join("");
          fc.pre(quote.trim() !== "");
          const text = ps.join("");
          const m = verifyQuote(seg(text), quote);
          expect(m.ok).toBe(true);
        },
      ),
    );
  });

  it("fails when one alphanumeric character is changed", () => {
    const source = fc.constantFrom(..."abcdefghijklm0123 ,.’—".split(""));
    const replacement = fc.constantFrom(..."nopqrstuvwxyz6789".split(""));
    fc.assert(
      fc.property(
        fc.array(source, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        replacement,
        (cs, a, b, c, r) => {
          const i = a % cs.length;
          const j = i + 1 + (b % (cs.length - i));
          const quote = cs.slice(i, j);
          const alnum = quote.flatMap((ch, k) => (/[a-z0-9]/.test(ch) ? [k] : []));
          fc.pre(alnum.length > 0);
          quote[alnum[c % alnum.length] ?? 0] = r;
          expect(verifyQuote(seg(cs.join("")), quote.join("")).ok).toBe(false);
        },
      ),
    );
  });
});

describe("suggestNearMatches", () => {
  const segments = [
    { id: "s0", text: "Login works on staging. I still need to wire up the admin roles." },
    { id: "s1", text: "Yep, I'll have it ready by Friday." },
  ];

  it("offers the closest window with offsets into the source", () => {
    const [best] = suggestNearMatches(segments, "I will have it ready by Friday");
    expect(best).toMatchObject({ segmentId: "s1", text: "I'll have it ready by Friday." });
    expect(best && segments[1]?.text.slice(best.start, best.end)).toBe(best?.text);
  });

  it("returns nothing for unrelated text", () => {
    expect(suggestNearMatches(segments, "budget approved for Q3 hiring")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(suggestNearMatches(segments, "ready by Friday", { limit: 2 })).toHaveLength(2);
  });
});

describe("probeQuote", () => {
  const segment = (id: string, text: string) => ({
    id,
    participantId: "p1",
    startMs: 61000,
    origin: "paste" as const,
    edited: false,
    text,
  });
  const src: QuoteSources = {
    probes: [
      { id: "q1", candidateId: "c1", splitId: null },
      { id: "q2", candidateId: null, splitId: "s1" },
      { id: "q3", candidateId: "c-missing", splitId: null },
    ],
    splits: [{ id: "s1", probeId: "q1" }],
    candidates: [{ id: "c1", decisionId: "d1" }],
    decisions: [
      {
        decision: { id: "d1" },
        evidence: [
          { segmentId: "seg1", quote: "said something else" },
          { segmentId: "seg2", quote: "SSO ready by Friday" },
        ],
      },
    ],
    segments: [segment("seg1", "Not in here."), segment("seg2", "I'll have SSO ready by Friday.")],
  };

  it("skips a quote that no longer matches its segment and keeps no transcript text", () => {
    expect(probeQuote("q1", src)).toEqual({
      quote: "SSO ready by Friday",
      segment: { id: "seg2", participantId: "p1", startMs: 61000, origin: "paste", edited: false },
    });
  });

  it("gives a recheck question its original question's quote", () => {
    expect(probeQuote("q2", src)).toEqual(probeQuote("q1", src));
  });

  it("is null without a decision to quote", () => {
    expect(probeQuote("q3", src)).toBeNull();
    expect(probeQuote("nope", src)).toBeNull();
  });
});
