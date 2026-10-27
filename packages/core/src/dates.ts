export interface DateReading {
  /** Calendar date in the meeting's time zone, `YYYY-MM-DD`. */
  date: string;
  label: string;
}

const DAY_MS = 86_400_000;

const WEEKDAY =
  "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const NUMBERS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const re = (src: string) => new RegExp(src, "i");
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const MONTH_DAY = re(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`);
const DAY_MONTH = re(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+(\\d{4}))?`);
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/;
const ORDINAL_DAY = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i;
const WEEKDAY_WORD = re(`\\b${WEEKDAY}\\b`);
const IN_N = /\bin\s+(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week)s?\b/i;

/** Days since 1970-01-01 for a civil date; arithmetic on these never meets DST. */
function dayNumber(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
function weekdayOf(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

function partsOf(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function validDay(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const day = dayNumber(y, m, d);
  return partsOf(day).d === d ? day : null;
}

/** The civil date of `instant` in `timezone`. Throws RangeError for an unknown zone. */
export function localDay(instant: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return dayNumber(get("year"), get("month"), get("day"));
}

function monthIndex(name: string): number {
  return (
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      name.slice(0, 3).toLowerCase(),
    ) + 1
  );
}

function weekdayIndex(name: string): number {
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(name.slice(0, 3).toLowerCase());
}

// A month and day without a year means the next time that date comes round.
function upcoming(today: number, m: number, d: number, year?: string): number | null {
  const { y } = partsOf(today);
  if (year !== undefined)
    return validDay(year.length === 2 ? 2000 + Number(year) : Number(year), m, d);
  const day = validDay(y, m, d);
  if (day !== null && day >= today) return day;
  return validDay(y + 1, m, d);
}

function endOfMonth(today: number, monthsAhead: number): DateReading[] {
  const { y, m } = partsOf(today);
  const last = dayNumber(y, m + monthsAhead + 1, 1) - 1;
  const out = [{ date: isoOf(last), label: "last day of the month" }];
  const wd = weekdayOf(last);
  if (wd >= 5) out.push({ date: isoOf(last - (wd - 4)), label: "last working day of the month" });
  return out;
}

function endOfWeek(monday: number, label: string): DateReading[] {
  return [
    { date: isoOf(monday + 4), label: `Friday ${label}` },
    { date: isoOf(monday + 6), label: `Sunday ${label}` },
  ];
}

function readings(p: string, today: number): DateReading[] {
  const wdToday = weekdayOf(today);
  const thisMonday = today - wdToday;
  const nextMonday = thisMonday + 7;

  const iso = ISO_DATE.exec(p);
  if (iso) {
    const day = validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return day === null ? [] : [{ date: isoOf(day), label: "stated date" }];
  }

  const md = MONTH_DAY.exec(p) ?? null;
  const dm = md ? null : DAY_MONTH.exec(p);
  if (md || dm) {
    const [month, dayText, year] = md ? [md[1], md[2], md[3]] : [dm?.[2], dm?.[1], dm?.[3]];
    const day = upcoming(today, monthIndex(month ?? ""), Number(dayText), year);
    return day === null ? [] : [{ date: isoOf(day), label: "stated date" }];
  }

  const num = NUMERIC_DATE.exec(p);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const out: DateReading[] = [];
    const us = upcoming(today, a, b, num[3]);
    if (us !== null) out.push({ date: isoOf(us), label: "month/day" });
    const intl = a === b ? null : upcoming(today, b, a, num[3]);
    if (intl !== null) out.push({ date: isoOf(intl), label: "day/month" });
    return out;
  }

  const ord = ORDINAL_DAY.exec(p);
  if (ord) {
    const { y, m } = partsOf(today);
    const d = Number(ord[1]);
    const thisMonth = validDay(y, m, d);
    const day = thisMonth !== null && thisMonth >= today ? thisMonth : validDay(y, m + 1, d);
    return day === null ? [] : [{ date: isoOf(day), label: `the ${ord[1]}${ord[0].slice(-2)}` }];
  }

  if (/\bday after tomorrow\b/i.test(p))
    return [{ date: isoOf(today + 2), label: "day after tomorrow" }];
  if (/\btomorrow\b/i.test(p)) return [{ date: isoOf(today + 1), label: "tomorrow" }];

  const wd = WEEKDAY_WORD.exec(p);
  if (wd) {
    const target = weekdayIndex(wd[1] ?? "");
    const name = WEEKDAY_NAMES[target] ?? "";
    if (/\bnext\s+week\b/i.test(p)) {
      return [{ date: isoOf(nextMonday + target), label: `${name} next week` }];
    }
    const ahead = (target - wdToday + 7) % 7;
    const nearest = today + ahead;
    if (re(`\\bnext\\s+${WEEKDAY}\\b`).test(p)) {
      // "next Friday" said early in the week can mean this week's or next week's Friday.
      if (ahead === 0) return [{ date: isoOf(today + 7), label: `${name} next week` }];
      return [
        { date: isoOf(nearest), label: `the coming ${name}` },
        { date: isoOf(nearest + 7), label: `${name} of the following week` },
      ];
    }
    if (ahead === 0) {
      return [
        { date: isoOf(today), label: `today (${name})` },
        { date: isoOf(today + 7), label: `${name} next week` },
      ];
    }
    return [{ date: isoOf(nearest), label: `this ${name}` }];
  }

  if (/\b(end of (the )?next week|next week)\b/i.test(p)) return endOfWeek(nextMonday, "next week");
  if (/\b(end of (the |this )?week|eow|this week|before the weekend)\b/i.test(p)) {
    return wdToday >= 5 ? endOfWeek(nextMonday, "next week") : endOfWeek(thisMonday, "this week");
  }
  if (/\b(end of (the )?next month)\b/i.test(p)) return endOfMonth(today, 1);
  if (/\b(end of (the |this )?month|eom)\b/i.test(p)) return endOfMonth(today, 0);

  const inN = IN_N.exec(p);
  if (inN) {
    const n = NUMBERS[inN[1]?.toLowerCase() ?? ""] ?? Number(inN[1]);
    const days = inN[2]?.toLowerCase() === "week" ? n * 7 : n;
    return [{ date: isoOf(today + days), label: `in ${days} days` }];
  }

  if (/\b(today|tonight|eod|end of (the )?day|cob|close of business)\b/i.test(p)) {
    return [{ date: isoOf(today), label: "today" }];
  }
  return [];
}

/**
 * Candidate calendar dates for a deadline phrase, resolved against when and where the
 * meeting was held. More than one reading means the phrase is ambiguous. These are
 * readings only; a date reaches a confirmed field only after participants confirm it.
 */
export function resolveDatePhrase(phrase: string, heldAt: string, timezone: string): DateReading[] {
  const today = localDay(heldAt, timezone);
  const seen = new Set<string>();
  return readings(phrase, today).filter((r) => !seen.has(r.date) && seen.add(r.date));
}

const VAGUE = [
  /\bsoon\b/i,
  /\basap\b/i,
  /\bas soon as possible\b/i,
  /\bthe usual\b/i,
  /\bend of (the |this )?week\b/i,
  /\beow\b/i,
  /\b(early |later |sometime )?(this|next) week\b/i,
  /\bat some point\b/i,
  /\bsometime\b/i,
  /\bshortly\b/i,
  /\bbefore long\b/i,
  /\bin a (bit|while)\b/i,
  /\bin the (coming|next few) (days|weeks)\b/i,
  /\b(a few|a couple of) (days|weeks)\b/i,
  /\bwhen(ever)? (possible|we can|it's ready|ready)\b/i,
];

const CONCRETE = [ISO_DATE, MONTH_DAY, DAY_MONTH, NUMERIC_DATE, ORDINAL_DAY, WEEKDAY_WORD];

/** Vague timing expressions found in `text`, as written. */
export function findVagueTerms(text: string): string[] {
  return VAGUE.flatMap((v) => {
    const m = v.exec(text);
    return m ? [m[0]] : [];
  });
}

/** True when `term` uses a vague timing expression and names no concrete date or weekday. */
export function isVague(term: string): boolean {
  return findVagueTerms(term).length > 0 && !CONCRETE.some((c) => c.test(term));
}
