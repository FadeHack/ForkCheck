/** The zone's offset from UTC at `utcMs`, in minutes (positive east of Greenwich). */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMs);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * Turns a `datetime-local` value (`2026-10-26T15:00`) read as wall time in `timeZone` into an
 * ISO instant. Returns null for an unparseable value or an unknown zone.
 */
export function wallTimeToInstant(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  try {
    // Two passes settle the offset when the first guess lands across a DST change.
    let utc = asUtc - offsetMinutes(asUtc, timeZone) * 60_000;
    utc = asUtc - offsetMinutes(utc, timeZone) * 60_000;
    return new Date(utc).toISOString();
  } catch {
    return null;
  }
}

export function formatHeldAt(instant: string, timeZone: string): string {
  try {
    // dateStyle and timeStyle can't be combined with timeZoneName, so the fields are spelled out.
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(instant));
  } catch {
    return instant;
  }
}

/** The calendar day of `instant` in `timeZone`, such as "Nov 10, 2026". */
export function formatDay(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(
      new Date(instant),
    );
  } catch {
    return instant;
  }
}
