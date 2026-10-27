import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findVagueTerms, isVague, resolveDatePhrase } from "../src/index";

const NY = "America/New_York";
// Wednesday Oct 28, 2026, 2 pm in New York.
const WED = "2026-10-28T14:00:00-04:00";
const dates = (phrase: string, heldAt = WED, tz = NY) =>
  resolveDatePhrase(phrase, heldAt, tz).map((r) => r.date);

describe("resolveDatePhrase on a Wednesday", () => {
  it.each([
    ["by Friday", ["2026-10-30"]],
    ["this Friday", ["2026-10-30"]],
    ["FRI", ["2026-10-30"]],
    ["next Friday", ["2026-10-30", "2026-11-06"]],
    ["Friday next week", ["2026-11-06"]],
    ["next week Friday", ["2026-11-06"]],
    ["Wednesday", ["2026-10-28", "2026-11-04"]],
    ["next Wednesday", ["2026-11-04"]],
    ["Monday", ["2026-11-02"]],
    ["tomorrow", ["2026-10-29"]],
    ["the day after tomorrow", ["2026-10-30"]],
    ["EOD", ["2026-10-28"]],
    ["end of day Friday", ["2026-10-30"]],
    ["end of the week", ["2026-10-30", "2026-11-01"]],
    ["next week", ["2026-11-06", "2026-11-08"]],
    ["end of month", ["2026-10-31", "2026-10-30"]],
    ["end of next month", ["2026-11-30"]],
    ["in two weeks", ["2026-11-11"]],
    ["in 3 days", ["2026-10-31"]],
    ["Oct 30", ["2026-10-30"]],
    ["October 30th, 2026", ["2026-10-30"]],
    ["30th of October", ["2026-10-30"]],
    ["October 2", ["2027-10-02"]],
    ["2026-11-03", ["2026-11-03"]],
    ["11/3", ["2026-11-03", "2027-03-11"]],
    ["11/11", ["2026-11-11"]],
    ["the 3rd", ["2026-11-03"]],
    ["the 30th", ["2026-10-30"]],
    ["Feb 30", []],
    ["soon", []],
    ["the usual", []],
  ])("%s", (phrase, expected) => {
    expect(dates(phrase)).toEqual(expected);
  });

  it("labels each reading", () => {
    expect(resolveDatePhrase("next Friday", WED, NY)).toEqual([
      { date: "2026-10-30", label: "the coming Friday" },
      { date: "2026-11-06", label: "Friday of the following week" },
    ]);
  });
});

describe("resolveDatePhrase across time zones", () => {
  // 02:00 UTC on Fri Oct 30 is still Thursday evening in the Americas.
  const instant = "2026-10-30T02:00:00Z";

  it.each([
    [NY, ["2026-10-30"], "2026-10-30"],
    ["America/Los_Angeles", ["2026-10-30"], "2026-10-30"],
    ["Europe/London", ["2026-10-30", "2026-11-06"], "2026-10-31"],
    ["Asia/Tokyo", ["2026-10-30", "2026-11-06"], "2026-10-31"],
  ])("%s", (tz, friday, tomorrow) => {
    expect(dates("Friday", instant, tz)).toEqual(friday);
    expect(dates("tomorrow", instant, tz)).toEqual([tomorrow]);
  });

  it("handles half-hour and far-east offsets", () => {
    expect(dates("tomorrow", "2026-10-28T19:00:00Z", "Asia/Kolkata")).toEqual(["2026-10-30"]);
    expect(dates("tomorrow", "2026-10-28T12:30:00Z", "Pacific/Auckland")).toEqual(["2026-10-30"]);
  });

  it("throws for an unknown zone", () => {
    expect(() => resolveDatePhrase("Friday", WED, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("resolveDatePhrase around DST changes", () => {
  it("uses EST after the US change on Sun Nov 1, 2026", () => {
    // 23:30 EST on Sunday; a fixed EDT offset would wrongly make this Monday.
    const late = "2026-11-02T04:30:00Z";
    expect(dates("Monday", late)).toEqual(["2026-11-02"]);
    expect(dates("tomorrow", late)).toEqual(["2026-11-02"]);
  });

  it("treats both 1:30 am hours on Nov 1 as the same day", () => {
    for (const t of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
      expect(dates("in 1 day", t)).toEqual(["2026-11-02"]);
    }
  });

  it("rolls end of week to next week on a Sunday", () => {
    expect(dates("end of the week", "2026-11-01T04:30:00Z")).toEqual(["2026-11-06", "2026-11-08"]);
  });

  it("uses BST before the UK change on Sun Oct 25, 2026", () => {
    // 00:30 BST on Sunday Oct 25, still Saturday in UTC.
    expect(dates("tomorrow", "2026-10-24T23:30:00Z", "Europe/London")).toEqual(["2026-10-26"]);
  });
});

describe("resolveDatePhrase properties", () => {
  const instant = fc
    .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 11, 31) })
    .map((ms) => new Date(ms).toISOString());
  const tz = fc.constantFrom(NY, "Europe/London", "Asia/Kolkata", "Pacific/Auckland", "UTC");
  const day = fc.constantFrom(
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  );

  it("reads a weekday as that weekday, today or within the next 13 days", () => {
    fc.assert(
      fc.property(instant, tz, day, fc.constantFrom("", "next ", "this "), (t, z, d, prefix) => {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: z }).format(new Date(t));
        for (const r of resolveDatePhrase(`${prefix}${d}`, t, z)) {
          const gap = (Date.parse(r.date) - Date.parse(today)) / 86_400_000;
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThan(14);
          const name = new Date(r.date).toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "UTC",
          });
          expect(name).toBe(d);
        }
      }),
    );
  });
});

describe("isVague", () => {
  it.each([
    "soon",
    "ASAP",
    "as soon as possible",
    "the usual",
    "by the end of the week",
    "EOW",
    "early next week",
    "next week",
    "in a couple of days",
    "at some point",
    "whenever it's ready",
  ])("vague: %s", (term) => {
    expect(isVague(term)).toBe(true);
  });

  it.each([
    "by Friday",
    "Friday next week",
    "end of the week, so Friday Oct 30",
    "2026-10-30",
    "tomorrow",
    "end of month",
    "in two weeks",
  ])("not vague: %s", (term) => {
    expect(isVague(term)).toBe(false);
  });

  it("lists every vague expression found", () => {
    expect(findVagueTerms("ASAP, ideally this week")).toEqual(["ASAP", "this week"]);
  });
});
