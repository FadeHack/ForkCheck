import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RecordItem } from "@forkcheck/core";
import type { RecordResponse, RevealedSplit } from "../../src/contracts/api";
import { noSplitLine, RecordView } from "../../src/ui/record/view";
import { answer, meeting, participants, probe, split } from "./fixtures";

const html = (node: React.ReactElement) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");

function revealed(id: string, outcome: RevealedSplit["split"]["outcome"], kind = "diagnostic") {
  const p = probe(id, {
    kind: kind as "diagnostic" | "recheck",
    splitId: kind === "recheck" ? "s1" : null,
  });
  return {
    split: split(`s-${id}`, id, { outcome }),
    probe: { id, kind: p.kind, splitId: p.splitId, stem: p.stem, options: p.options },
    quote: null,
    answers: [answer("p0", id, `${id}-a`), answer("p1", id, `${id}-b`)],
    resolutions: [],
    confirmations: [],
  } satisfies RevealedSplit;
}

const item = (overrides: Partial<RecordItem>): RecordItem => ({
  id: "m1:item:0",
  meetingId: "m1",
  category: "stated",
  text: "Dana will tell them Friday.",
  sourceRefs: [
    { kind: "segment", segmentId: "seg1", quote: "Dana will tell them Friday.", origin: "asr" },
  ],
  confirmedBy: [],
  absent: [],
  recheck: "not_run",
  splitId: null,
  deadline: null,
  ...overrides,
});

const q1 = {
  ...revealed("q1", "split"),
  split: { ...split("s1", "q1"), status: "rechecked" as const },
};
const data: RecordResponse = {
  record: {
    meetingId: "m1",
    title: meeting.title,
    heldAt: meeting.heldAt,
    generatedAt: meeting.createdAt,
    participants: participants.map((p, i) => (i === 2 ? { ...p, status: "absent" } : p)),
    items: [
      item({}),
      item({
        id: "m1:item:1",
        category: "confirmed",
        text: "Single sign-on runs on staging on Friday.",
        sourceRefs: [
          { kind: "confirmation", resolutionId: "r1" },
          {
            kind: "segment",
            segmentId: "seg1",
            quote: "Dana will tell them Friday.",
            origin: "asr",
          },
        ],
        confirmedBy: ["p0", "p1"],
        absent: ["p2"],
        recheck: "passed",
        splitId: "s1",
      }),
    ],
    proseDraft: null,
  },
  validation: { ok: true, findings: [] },
  sources: [
    {
      id: "seg1",
      participantId: "p2",
      startMs: 252_000,
      origin: "asr",
      edited: false,
      text: "Dana will tell them Friday. Probably on staging.",
    },
  ],
  questions: [q1, revealed("q2", "consistent"), revealed("rq", "consistent", "recheck")],
};

describe("noSplitLine", () => {
  it("counts diagnostic questions only and never says aligned", () => {
    const line = noSplitLine([
      revealed("a", "split"),
      revealed("b", "consistent"),
      revealed("c", "consistent"),
      revealed("d", "insufficient"),
      revealed("r", "consistent", "recheck"),
    ]);
    expect(line).toBe(
      "No split found on 2 of 4 questions. 1 had too few answers to compare. That doesn't prove everyone understood the same thing.",
    );
    expect(noSplitLine([revealed("a", "consistent")])).toMatch(
      /^No split found on 1 of 1 question\./,
    );
    expect(noSplitLine([])).toBe("No questions have been revealed yet, so nothing was compared.");
    for (const l of [line, noSplitLine([])]) expect(l.toLowerCase()).not.toContain("aligned");
  });
});

describe("RecordView", () => {
  const out = html(<RecordView data={data} />);

  it("links every source to an element on the page", () => {
    const hrefs = [...out.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
    const ids = new Set([...out.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "segment-seg1",
        "confirmations-m1-item-1",
        "question-s1",
        "question-s-rq",
      ]),
    );
    for (const h of hrefs) expect(ids).toContain(h);
  });

  it("names the speaker and time, marks transcription and keeps the absent person listed", () => {
    expect(out).toContain("Transcript: Dana at 04:12");
    expect(out).toContain("<strong>Automatic transcription.</strong>");
    expect(out).toContain("Absent, not asked");
    expect(out).toContain("Recheck passed");
    expect(out).toContain("No split found on 1 of 2 questions.");
  });
});
