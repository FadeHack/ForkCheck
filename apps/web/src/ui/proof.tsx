import type { ReactNode } from "react";

const word = /[\p{L}\p{N}']+/gu;

/**
 * The longest run of two or more words that a quoted phrase in the question shares with the
 * transcript quote, as offsets into the quote. That run is what the question asks about, so the
 * reveal circles it.
 */
export function askedPhrase(quote: string, stem: string): { start: number; end: number } | null {
  const spans = [...quote.matchAll(word)].map((m) => ({
    text: m[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
  const fragments = [...stem.matchAll(/["“]([^"”]+)["”]/g)].map((m) =>
    [...m[1]!.matchAll(word)].map((w) => w[0].toLowerCase()),
  );
  let best: { from: number; length: number } | null = null;
  for (const frag of fragments) {
    for (let i = 0; i < spans.length; i++) {
      for (let j = 0; j < frag.length; j++) {
        let n = 0;
        while (i + n < spans.length && j + n < frag.length && spans[i + n]!.text === frag[j + n])
          n++;
        if (n >= 2 && (!best || n > best.length)) best = { from: i, length: n };
      }
    }
  }
  if (!best) return null;
  return { start: spans[best.from]!.start, end: spans[best.from + best.length - 1]!.end };
}

/** A red-pencil ring around a phrase, the way an editor marks a word to query. */
export function PencilCircle({ children }: { children: ReactNode }) {
  return (
    <span className="pencil-circle">
      {children}
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M8 22 C6 8 60 3 110 4 C160 5 196 10 194 22 C192 35 140 38 96 37 C50 36 10 33 9 20 C9 14 20 9 34 7" />
      </svg>
    </span>
  );
}

/** Past this many characters a ring would wrap badly, so the phrase gets a pencil line instead. */
const RING_MAX = 28;

/** A ring for a short phrase, a wavy pencil line under a long one. */
function PencilMark({ children }: { children: string }) {
  return children.length > RING_MAX ? (
    <span className="pencil-line">{children}</span>
  ) : (
    <PencilCircle>{children}</PencilCircle>
  );
}

function marked(text: string, at: { start: number; end: number } | null): ReactNode {
  if (!at) return text;
  return (
    <>
      {text.slice(0, at.start)}
      <PencilMark>{text.slice(at.start, at.end)}</PencilMark>
      {text.slice(at.end)}
    </>
  );
}

/** The quote with the asked-about phrase marked, or as written when no phrase matches. */
export function markedQuote(quote: string, stem: string | undefined): ReactNode {
  return marked(quote, stem ? askedPhrase(quote, stem) : null);
}

/**
 * The question with the words it asks about marked: the last quoted fragment, which is the
 * detail ("the end of next week") after the decision it belongs to.
 */
export function markedStem(stem: string): ReactNode {
  const last = [...stem.matchAll(/["“]([^"”]+)["”]/g)].at(-1);
  if (!last) return stem;
  // The quote marks go inside the mark, so a wrap never strands one at a line end.
  return marked(stem, { start: last.index, end: last.index + last[0].length });
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayPattern =
  /\b(sun|mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?\.?\b\D{0,8}?\b(\d{1,2})(?:st|nd|rd|th)?\b/i;
const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** A day of the month and its weekday, from text such as "Thursday the 12th" or "2026-11-12". */
export function dayOf(text: string): { day: number; weekday: number } | null {
  const iso = isoPattern.exec(text);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (Number.isNaN(date.getTime())) return null;
    return { day: date.getUTCDate(), weekday: date.getUTCDay() };
  }
  const m = weekdayPattern.exec(text);
  if (!m) return null;
  const day = Number(m[2]);
  if (day < 1 || day > 31) return null;
  return {
    day,
    weekday: weekdays.findIndex((w) => m[1]!.toLowerCase().startsWith(w.toLowerCase())),
  };
}

export interface CalendarPick {
  day: number;
  who: string;
}

/**
 * Days to draw when every chosen option names a day and they fit one calendar: at least two
 * different days, within two weeks, with weekdays that agree. Otherwise null, and the reveal
 * shows the plain fork.
 */
export function calendarFor(
  picks: { text: string; who: string }[],
): { days: { day: number; label: string; who: string[] }[] } | null {
  const parsed = picks.map((p) => ({ ...p, at: dayOf(p.text) }));
  if (parsed.some((p) => p.at === null)) return null;
  const all = parsed.map((p) => ({ who: p.who, ...p.at! }));
  const distinct = new Set(all.map((p) => p.day));
  if (distinct.size < 2) return null;
  const offset = (p: { day: number; weekday: number }) => (((p.weekday - p.day) % 7) + 7) % 7;
  if (new Set(all.map(offset)).size !== 1) return null;
  const min = Math.min(...distinct);
  const max = Math.max(...distinct);
  if (max - min > 13) return null;
  const from = Math.max(1, min - 2);
  const to = Math.min(max + 2, Math.max(28, max));
  const shift = offset(all[0]!);
  const days = [];
  for (let d = from; d <= to; d++) {
    days.push({
      day: d,
      label: `${weekdays[(d + shift) % 7]} ${d}`,
      who: all.filter((p) => p.day === d).map((p) => p.who),
    });
  }
  return { days };
}

/** The split as days on a calendar strip. The branch list says the same in words. */
export function CalendarStrip({ days }: { days: { day: number; label: string; who: string[] }[] }) {
  return (
    <ol className="calendar-strip" aria-hidden="true">
      {days.map((d) => (
        <li key={d.day} data-picked={d.who.length > 0 || undefined}>
          <span className="calendar-day">{d.label}</span>
          {d.who.length > 0 && <span className="calendar-who">{d.who.join(", ")}</span>}
        </li>
      ))}
    </ol>
  );
}
