import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { askedPhrase, calendarFor, dayOf, markedStem } from "../../src/ui/proof";

const at = (quote: string, stem: string) => {
  const r = askedPhrase(quote, stem);
  return r && quote.slice(r.start, r.end);
};

describe("askedPhrase", () => {
  it("finds the quoted words the question asks about", () => {
    expect(
      at(
        "Good. I want Atlas out to every customer by the end of next week.",
        'For "Atlas will be out to every customer", what has to exist by "the end of next week"?',
      ),
    ).toBe("the end of next week");
  });

  it("matches across case and keeps the quote's own wording", () => {
    expect(
      at(
        "So we'll get the help center page done before launch.",
        'For "The help center page will be done before launch", who does it?',
      ),
    ).toBe("the help center page");
  });

  it("needs at least two shared words", () => {
    expect(at("Ship it Friday.", 'What does "Friday" mean?')).toBeNull();
    expect(at("Ship it Friday.", "What does Friday mean?")).toBeNull();
  });
});

describe("dayOf", () => {
  it("reads weekday and day in common forms", () => {
    expect(dayOf("Full release by Thursday the 12th")).toEqual({ day: 12, weekday: 4 });
    expect(dayOf("Fri 13 Nov")).toEqual({ day: 13, weekday: 5 });
    expect(dayOf("Atlas is on by 2026-11-12, 09:00 ET")).toEqual({ day: 12, weekday: 4 });
  });

  it("ignores text with no day", () => {
    expect(dayOf("June does it")).toBeNull();
    expect(dayOf("By Friday")).toBeNull();
  });
});

describe("calendarFor", () => {
  it("draws the days around the picks", () => {
    const cal = calendarFor([
      { text: "Full release by Thursday the 12th", who: "June" },
      { text: "Full release by Friday the 13th", who: "Nadia and Tomas" },
    ]);
    expect(cal?.days.map((d) => d.label)).toEqual([
      "Tue 10",
      "Wed 11",
      "Thu 12",
      "Fri 13",
      "Sat 14",
      "Sun 15",
    ]);
    expect(cal?.days.find((d) => d.day === 13)?.who).toEqual(["Nadia and Tomas"]);
  });

  it("falls back when an option has no day, the days agree, or the weekdays clash", () => {
    expect(
      calendarFor([
        { text: "Thursday the 12th", who: "A" },
        { text: "Soon", who: "B" },
      ]),
    ).toBeNull();
    expect(
      calendarFor([
        { text: "Thursday the 12th", who: "A" },
        { text: "Thu 12", who: "B" },
      ]),
    ).toBeNull();
    expect(
      calendarFor([
        { text: "Thursday the 12th", who: "A" },
        { text: "Thursday the 13th", who: "B" },
      ]),
    ).toBeNull();
  });
});

describe("markedStem", () => {
  const html = (stem: string) => renderToStaticMarkup(<>{markedStem(stem)}</>);

  it("rings the last quoted fragment, quote marks included", () => {
    expect(
      html(
        'For "Atlas will be out to every customer", what has to exist by "the end of next week"?',
      ),
    ).toContain('<span class="pencil-circle">&quot;the end of next week&quot;<svg');
  });

  it("underlines a fragment too long for a ring, and leaves a stem with no quotes alone", () => {
    expect(
      html('When "Atlas will be out to every customer by the end of next week" is done?'),
    ).toContain('<span class="pencil-line">&quot;Atlas will be out');
    expect(html("On Monday, what do they find?")).toBe("On Monday, what do they find?");
  });
});
