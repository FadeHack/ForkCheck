import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dedupeProbes,
  lintDebatedTarget,
  lintLengthRatio,
  lintOneDimension,
  lintOptionCount,
  lintPresupposition,
  lintProbe,
  lintRecheck,
  lintRecheckNovelty,
  lintVerbatimSpeaker,
  stemOverlap,
  type ProbeTarget,
} from "../src/index";

const opts = (...texts: string[]) => texts.map((text) => ({ text }));
const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);
const target = (
  id = "d1",
  dimension: ProbeTarget["dimension"] = "deadline",
  status: ProbeTarget["decision"]["status"] = "ambiguous",
): ProbeTarget => ({ decision: { id, status }, dimension });

const segments = [
  { text: "OK, so SSO is ready by Friday. Marco, that's yours?" },
  { text: "Yep, I’ll have it ready by Friday." },
];

describe("lintOptionCount", () => {
  it.each([
    [opts("a", "b"), []],
    [opts("a", "b", "c", "d"), []],
    [opts("a"), ["option_count"]],
    [opts(), ["option_count"]],
    [opts("a", "b", "c", "d", "e"), ["option_count"]],
  ])("%j", (options, expected) => {
    expect(rules(lintOptionCount(options))).toEqual(expected);
  });
});

describe("lintLengthRatio", () => {
  it.each([
    [opts("Friday Oct 30", "Friday Nov 6"), []],
    // 25 vs 10 characters: exactly 2.5× passes.
    [opts("abcdefghij", "abcdefghijklmnopqrstuvwxy"), []],
    [opts("abcdefghij", "abcdefghijklmnopqrstuvwxyz"), ["length_ratio"]],
    [opts("Yes", "Only after the customer's admins can log in on production"), ["length_ratio"]],
    [opts("  ", "Anything"), ["length_ratio"]],
    [opts("one"), []],
  ])("%j", (options, expected) => {
    expect(rules(lintLengthRatio(options))).toEqual(expected);
  });
});

describe("lintVerbatimSpeaker", () => {
  it.each([
    [opts("Staging, code complete", "Production, customer can log in"), []],
    // Short and generic: under three words never counts.
    [opts("by Friday", "next week"), []],
    // A whole three-word option inside a turn.
    [opts("ready by Friday", "Production on Monday"), ["verbatim_speaker"]],
    // A five-word run inside a longer option, across curly and straight apostrophes.
    [opts("I'll have it ready by Friday, staging only", "Production"), ["verbatim_speaker"]],
    // Case and punctuation differences do not hide a quote.
    [opts("SSO IS READY, BY FRIDAY", "Something else"), ["verbatim_speaker"]],
  ])("%j", (options, expected) => {
    expect(rules(lintVerbatimSpeaker(options, segments))).toEqual(expected);
  });

  it("reports one finding per offending option", () => {
    const f = lintVerbatimSpeaker(opts("ready by Friday", "SSO is ready by Friday"), segments);
    expect(f.map((x) => x.detail)).toEqual([
      'option 1 repeats "ready by friday"',
      'option 2 repeats "sso is ready by friday"',
    ]);
  });
});

describe("lintPresupposition", () => {
  it.each([
    ["When Marco said Friday, which outcome did you picture?", []],
    ["Which of these matches what you expect to see?", []],
    ["Where do you disagree with Marco?", ["presupposition"]],
    ["Was there confusion about the date?", ["presupposition"]],
    ["Which reading is correct?", ["presupposition"]],
    ["Which reading is incorrect?", ["presupposition"]],
    ["Did anyone misunderstand the plan?", ["presupposition"]],
    ["It was obviously Friday, but which one?", ["presupposition"]],
    ["Disagreements aside, who is confused?", ["presupposition", "presupposition"]],
  ])("%s", (stem, expected) => {
    expect(rules(lintPresupposition(stem))).toEqual(expected);
  });
});

describe("lintOneDimension", () => {
  it.each([
    ["Who sends the customer email?", [target()], []],
    ["What happens on Friday, in your view?", [target()], []],
    ["Who sends it, and when?", [target()], ["one_dimension"]],
    ["Who owns it and by when is it due", [target()], ["one_dimension"]],
    ["Who owns it? When is it due?", [target()], ["one_dimension"]],
    ["Who sends the email?", [], ["one_dimension"]],
    ["Who sends the email?", [target("d1", "owner"), target("d1", "deadline")], ["one_dimension"]],
  ])("%s", (stem, targets, expected) => {
    expect(rules(lintOneDimension(stem, targets))).toEqual(expected);
  });
});

describe("lintDebatedTarget", () => {
  it.each([
    ["ambiguous", []],
    ["explicit", []],
    ["unresolved", []],
    ["debated", ["debated_target"]],
  ] as const)("%s", (status, expected) => {
    expect(rules(lintDebatedTarget([target("d1", "deadline", status)]))).toEqual(expected);
  });
});

describe("dedupeProbes", () => {
  it("keeps the first probe per decision and dimension, in input order", () => {
    const probes = [
      { name: "a", target: target("d1", "deadline") },
      { name: "b", target: target("d1", "owner") },
      { name: "c", target: target("d1", "deadline") },
      { name: "d", target: target("d2", "deadline") },
    ];
    const { kept, dropped } = dedupeProbes(probes);
    expect(kept.map((p) => p.name)).toEqual(["a", "b", "d"]);
    expect(dropped).toEqual([
      {
        probe: probes[2],
        finding: { rule: "duplicate", detail: "probe 3 repeats probe 1 on d1/deadline" },
      },
    ]);
  });

  it("drops nothing when every pair is distinct", () => {
    const probes = [{ target: target("d1", "deadline") }, { target: target("d2", "deadline") }];
    expect(dedupeProbes(probes).dropped).toEqual([]);
  });
});

describe("lintRecheckNovelty", () => {
  const original = {
    stem: "When Marco says SSO is ready by Friday, what will be true on Friday?",
    resolutionText: "SSO with admin roles is live in production by Friday 10:00 ET.",
  };

  it.each([
    [
      "pass: asks about a consequence",
      {
        stem: "A customer admin tries to sign in Friday at 11:00. What happens?",
        options: opts("They get in", "They see a staging-only notice"),
      },
      [],
    ],
    [
      "fail: echoes the original stem",
      {
        stem: "When Marco says SSO is ready by Friday, what is true on Friday?",
        options: opts("Live in production", "On staging only"),
      },
      ["recheck_overlap"],
    ],
    [
      "fail: an option is the resolution, modulo case and punctuation",
      {
        stem: "A customer admin tries to sign in Friday at 11:00. What happens?",
        options: opts(
          "sso with admin roles is live in production by friday 10:00 et",
          "They see a notice",
        ),
      },
      ["recheck_restates_resolution"],
    ],
  ])("%s", (_name, recheck, expected) => {
    expect(rules(lintRecheckNovelty(recheck, original))).toEqual(expected);
  });

  it("measures overlap on content words", () => {
    expect(stemOverlap("Who ships the dates?", "Who shipped the date?")).toBe(1);
    expect(stemOverlap("Who ships it?", "What breaks on Monday?")).toBe(0);
    expect(stemOverlap("", "")).toBe(1);
  });
});

describe("lintProbe and lintRecheck", () => {
  it("passes a clean diagnostic probe", () => {
    const probe = {
      stem: "When Marco said Friday, which of these did you picture?",
      options: opts("Merged to staging", "Live in production", "Customer admins can log in"),
    };
    expect(lintProbe(probe, { targets: [target()], segments })).toEqual([]);
  });

  it("collects findings from every rule", () => {
    const probe = {
      stem: "Who disagrees, and when?",
      options: opts("ready by Friday"),
    };
    const targets = [target("d1", "deadline", "debated")];
    expect(rules(lintProbe(probe, { targets, segments }))).toEqual([
      "option_count",
      "verbatim_speaker",
      "presupposition",
      "one_dimension",
      "debated_target",
    ]);
  });

  it("runs novelty on rechecks", () => {
    const original = { stem: "What will be true on Friday?", resolutionText: "Live Friday." };
    const recheck = {
      stem: "What will be true on Friday?",
      options: opts("Live Friday", "Monday"),
    };
    expect(rules(lintRecheck(recheck, { original, segments }))).toEqual([
      "recheck_overlap",
      "recheck_restates_resolution",
    ]);
  });
});

describe("probe lint properties", () => {
  const structuredClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const draft = fc.record({
    stem: fc.string({ maxLength: 80 }),
    options: fc.array(fc.record({ text: fc.string({ maxLength: 40 }) }), { maxLength: 6 }),
  });
  const segs = fc.array(fc.record({ text: fc.string({ maxLength: 80 }) }), { maxLength: 4 });
  const status = fc.constantFrom("explicit", "ambiguous", "unresolved", "debated" as const);

  it("is deterministic: the same input gives the same findings", () => {
    fc.assert(
      fc.property(draft, segs, status, draft, (p, s, st, r) => {
        const ctx = { targets: [target("d1", "scope", st)], segments: s };
        expect(lintProbe(p, ctx)).toEqual(lintProbe(structuredClone(p), ctx));
        const original = { stem: p.stem, resolutionText: r.stem };
        expect(lintRecheck(r, { original, segments: s })).toEqual(
          lintRecheck(structuredClone(r), { original, segments: s }),
        );
      }),
    );
  });

  it("finds no verbatim quote when there are no turns", () => {
    fc.assert(
      fc.property(draft, (p) => {
        expect(lintVerbatimSpeaker(p.options, [])).toEqual([]);
      }),
    );
  });
});
