import { describe, expect, it } from "vitest";
import type { ProbeAnswerCount } from "../../src/contracts/api";
import {
  personStatus,
  revealBlockedReason,
  revealConfirmText,
  roundProgress,
} from "../../src/ui/organizer/round";
import { participants } from "./fixtures";

const count = (probeId: string, answeredBy: string[]): ProbeAnswerCount => ({
  probeId,
  answered: answeredBy.length,
  active: 3,
  answeredBy,
});

describe("roundProgress", () => {
  it("counts a person as done only once they answered every open question", () => {
    const p = roundProgress({
      participants,
      answerCounts: [count("q1", ["p0", "p1"]), count("q2", ["p0"])],
    });
    expect(p).toMatchObject({ total: 2, done: 1, active: 3, responders: 2, canReveal: true });
    expect(p.waitingFor).toEqual(["Marco", "Dana"]);
    expect(personStatus(p.people[1]!, 2)).toBe("Answered 1 of 2 questions");
  });

  it("needs 2 people to answer unless everyone has", () => {
    const one = roundProgress({ participants, answerCounts: [count("q1", ["p0"])] });
    expect(one.canReveal).toBe(false);
    expect(revealBlockedReason(one)).toBe(
      "Only 1 person has answered. At least 2 people need to answer first.",
    );
    const none = roundProgress({ participants, answerCounts: [count("q1", [])] });
    expect(revealBlockedReason(none)).toBe(
      "Nobody has answered yet. At least 2 people need to answer first.",
    );
    // With the others absent, the one person left answering is everyone.
    const alone = roundProgress({
      participants: participants.map((p, i) => (i === 0 ? p : { ...p, status: "absent" })),
      answerCounts: [count("q1", ["p0"])],
    });
    expect(alone).toMatchObject({ done: 1, active: 1, canReveal: true, waitingFor: [] });
    expect(revealBlockedReason(alone)).toBeNull();
  });

  it("ignores answers from people marked absent", () => {
    const p = roundProgress({
      participants: participants.map((p, i) => (i === 2 ? { ...p, status: "absent" } : p)),
      answerCounts: [count("q1", ["p0", "p2"])],
    });
    expect(p).toMatchObject({ done: 1, active: 2, responders: 1, canReveal: false });
  });
});

describe("revealConfirmText", () => {
  it("follows the design's wording for one name and for several", () => {
    expect(revealConfirmText(["Leo"])).toBe(
      "Leo hasn't answered. Reveal now? Leo's questions will show as no response.",
    );
    expect(revealConfirmText(["Leo", "Sam"])).toBe(
      "Leo and Sam haven't answered. Reveal now? Their questions will show as no response.",
    );
  });
});
