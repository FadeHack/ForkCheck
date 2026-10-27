import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseTranscript, segment } from "../src/index";

const people = [
  { id: "u-priya", displayName: "Priya" },
  { id: "u-marco", displayName: "Marco" },
  { id: "u-dana", displayName: "Dana Lee" },
];

const parse = (text: string, participants = people) =>
  parseTranscript({ meetingId: "m1", text, participants });

describe("parseTranscript", () => {
  it("emits segments that satisfy the contract", () => {
    const { segments } = parse("[00:20] Priya: SSO is ready by Friday.\n[00:25] Marco: Yep.");
    expect(segments.map((s) => s.participantId)).toEqual(["u-priya", "u-marco"]);
    expect(segments[0]).toMatchObject({ startMs: 20_000, endMs: null, origin: "paste" });
    for (const s of segments) expect(segment.safeParse(s).success).toBe(true);
  });

  it("assigns stable ids and indexes", () => {
    const { segments } = parse("Priya: one\nMarco: two");
    expect(segments.map((s) => [s.id, s.idx])).toEqual([
      ["m1:seg:0", 0],
      ["m1:seg:1", 1],
    ]);
  });

  it.each([
    ["colon inside text", "Priya: The agenda: launch, then QA", "The agenda: launch, then QA"],
    ["clock time", "Priya: Let's meet at 10:30 tomorrow", "Let's meet at 10:30 tomorrow"],
    ["URL", "Marco: Spec is at https://example.com/a:b", "Spec is at https://example.com/a:b"],
    ["extra spaces", "  Priya  :   hello  ", "hello"],
  ])("keeps the text intact: %s", (_name, line, text) => {
    expect(parse(line).segments[0]?.text).toBe(text);
  });

  it("treats a URL line as a continuation, not a speaker", () => {
    const { segments, warnings } = parse("Priya: The doc:\nhttps://example.com/doc");
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe("The doc:\nhttps://example.com/doc");
    expect(warnings).toEqual([]);
  });

  it("joins continuation lines and skips empty lines", () => {
    const { segments } = parse("Priya: first\n\n   second\n\nMarco: third");
    expect(segments.map((s) => s.text)).toEqual(["first\nsecond", "third"]);
  });

  it("handles Windows and old Mac line endings", () => {
    const { segments } = parse("Priya: one\r\nMarco: two\rDana Lee: three\r\n");
    expect(segments.map((s) => s.participantId)).toEqual(["u-priya", "u-marco", "u-dana"]);
  });

  it("matches names case-insensitively and across spacing", () => {
    const { segments, warnings } = parse("PRIYA: a\npriya: b\nDana   lee: c");
    expect(segments.map((s) => s.participantId)).toEqual(["u-priya", "u-priya", "u-dana"]);
    expect(warnings).toEqual([]);
  });

  it("reads mm:ss and hh:mm:ss timestamps", () => {
    const { segments } = parse("[01:05] Priya: a\n[1:02:03] Marco: b\nDana Lee: c");
    expect(segments.map((s) => s.startMs)).toEqual([65_000, 3_723_000, null]);
  });

  it("keeps an invalid timestamp as text", () => {
    const { segments, warnings } = parse("Priya: a\n[00:75] then this");
    expect(segments[0]?.text).toBe("a\n[00:75] then this");
    expect(warnings).toEqual([]);
  });

  it("starts a new segment for a timestamp without a name and reports it", () => {
    const { segments, warnings } = parse("[00:01] Priya: a\n[00:09] something unattributed");
    expect(segments[1]).toMatchObject({ participantId: null, startMs: 9_000 });
    expect(segments[1]?.text).toBe("something unattributed");
    expect(warnings).toEqual([{ code: "missing_speaker", line: 2, segmentIdx: 1, speaker: null }]);
  });

  it("reports text before the first speaker", () => {
    const { segments, warnings } = parse("notes from the sync\nPriya: a");
    expect(segments).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ code: "missing_speaker", segmentIdx: 0 });
  });

  it("reports unknown speakers instead of dropping them", () => {
    const { segments, warnings } = parse("Priya: a\nJordan Kim: b\nMarco: c");
    expect(segments).toHaveLength(3);
    expect(segments[1]).toMatchObject({ participantId: null, text: "b" });
    expect(warnings).toEqual([
      { code: "unknown_speaker", line: 2, segmentIdx: 1, speaker: "Jordan Kim" },
    ]);
  });

  it("reports an unknown speaker who said nothing", () => {
    const { segments, warnings } = parse("Priya: a\nJordan:\nMarco: c");
    expect(segments).toHaveLength(2);
    expect(warnings).toEqual([
      { code: "unknown_speaker", line: 2, segmentIdx: null, speaker: "Jordan" },
    ]);
  });

  it("reports participants whose names collide by case", () => {
    const { segments, warnings } = parse("Sam: hi", [
      { id: "u1", displayName: "Sam" },
      { id: "u2", displayName: "sam" },
    ]);
    expect(segments[0]?.participantId).toBeNull();
    expect(warnings[0]).toMatchObject({ code: "ambiguous_speaker", speaker: "Sam" });
  });

  it("does not treat a lowercase lead-in as an unknown speaker", () => {
    const { segments, warnings } = parse("Priya: plan below\nstep one: ship it");
    expect(segments).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(parse(" \n\r\n ")).toEqual({ segments: [], warnings: [] });
  });
});

describe("parseTranscript properties", () => {
  const name = fc.constantFrom("Priya", "marco", "DANA LEE", "Jordan");
  // Continuations avoid a leading `[` or a colon, which would make them a new turn by design.
  const continuation = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => !s.includes(":") && !s.trimStart().startsWith("["));
  const turn = fc.record({
    ts: fc.option(fc.tuple(fc.nat(59), fc.nat(59)), { nil: undefined }),
    name,
    text: fc.string({ maxLength: 40 }),
    more: fc.array(continuation, { maxLength: 2 }),
  });
  const eol = fc.constantFrom("\n", "\r\n", "\r");

  it("preserves every non-whitespace character of the turn bodies", () => {
    fc.assert(
      fc.property(fc.array(turn, { maxLength: 8 }), eol, (turns, nl) => {
        const lines = turns.flatMap((t) => {
          const stamp = t.ts ? `[${t.ts[0]}:${String(t.ts[1]).padStart(2, "0")}] ` : "";
          return [`${stamp}${t.name}: ${t.text}`, ...t.more];
        });
        const body = turns.flatMap((t) => [t.text, ...t.more]).join("");
        const { segments } = parse(lines.join(nl));
        const strip = (s: string) => s.replace(/\s+/g, "");
        expect(strip(segments.map((s) => s.text).join(""))).toBe(strip(body));
      }),
    );
  });
});
