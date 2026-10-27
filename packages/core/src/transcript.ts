import type { Participant, Segment } from "./model/index";

export type TranscriptWarningCode = "unknown_speaker" | "ambiguous_speaker" | "missing_speaker";

export interface TranscriptWarning {
  code: TranscriptWarningCode;
  /** 1-based line number in the pasted text. */
  line: number;
  /** Null when the turn had no text and produced no segment. */
  segmentIdx: number | null;
  /** The name as written; null for `missing_speaker`. */
  speaker: string | null;
}

export interface ParsedTranscript {
  segments: Segment[];
  warnings: TranscriptWarning[];
}

export interface ParseTranscriptInput {
  meetingId: string;
  text: string;
  participants: readonly Pick<Participant, "id" | "displayName">[];
  /** Defaults to `<meetingId>:seg:<idx>`. */
  segmentId?: (idx: number) => string;
}

const TIMESTAMP = /^\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*/;
// The colon must be followed by whitespace or end of line, so `https://` and `10:30` never split.
const SPEAKER = /^([\p{L}][\p{L}\p{M}\p{N}.'’ -]{0,39}?)\s*:(?=\s|$)\s*(.*)$/u;
const MAX_UNKNOWN_NAME_WORDS = 3;

export function normalizeName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function timestampMs(match: RegExpExecArray): number | null {
  const h = match[1] === undefined ? 0 : Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  if (s > 59 || (match[1] !== undefined && m > 59)) return null;
  return ((h * 60 + m) * 60 + s) * 1000;
}

// Lines like "Note: ..." are ambiguous; an unlisted name counts only if it looks like a name.
function looksLikeName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  return words.length <= MAX_UNKNOWN_NAME_WORDS && words.every((w) => /^\p{Lu}/u.test(w));
}

interface Turn {
  line: number;
  speaker: string | null;
  participantId: string | null;
  startMs: number | null;
  lines: string[];
  warning: TranscriptWarningCode | null;
}

/** Parses pasted `Name: text` turns, each with an optional `[mm:ss]` or `[hh:mm:ss]` prefix. */
export function parseTranscript(input: ParseTranscriptInput): ParsedTranscript {
  const byName = new Map<string, string[]>();
  for (const p of input.participants) {
    const key = normalizeName(p.displayName);
    byName.set(key, [...(byName.get(key) ?? []), p.id]);
  }

  const turns: Turn[] = [];
  const lines = input.text.split(/\r\n|\r|\n/);

  lines.forEach((raw, i) => {
    let rest = raw.trim();
    if (rest === "") return;

    let startMs: number | null = null;
    const ts = TIMESTAMP.exec(rest);
    if (ts) {
      const ms = timestampMs(ts);
      if (ms !== null) {
        startMs = ms;
        rest = rest.slice(ts[0].length);
      }
    }

    const sp = SPEAKER.exec(rest);
    const name = sp?.[1];
    const ids = name === undefined ? undefined : byName.get(normalizeName(name));
    if (sp && name !== undefined && (ids !== undefined || looksLikeName(name))) {
      const known = ids?.length === 1 ? ids[0] : undefined;
      turns.push({
        line: i + 1,
        speaker: name.trim(),
        participantId: known ?? null,
        startMs,
        lines: [sp[2] ?? ""],
        warning:
          known !== undefined ? null : ids === undefined ? "unknown_speaker" : "ambiguous_speaker",
      });
      return;
    }

    const last = turns.at(-1);
    if (startMs === null && last) {
      last.lines.push(rest);
      return;
    }
    // A timestamp starts a new turn even without a name, as does text before the first speaker.
    turns.push({
      line: i + 1,
      speaker: null,
      participantId: null,
      startMs,
      lines: [rest],
      warning: "missing_speaker",
    });
  });

  const segmentId = input.segmentId ?? ((idx: number) => `${input.meetingId}:seg:${idx}`);
  const segments: Segment[] = [];
  const warnings: TranscriptWarning[] = [];

  for (const turn of turns) {
    const text = turn.lines.filter((l) => l !== "").join("\n");
    const idx = text === "" ? null : segments.length;
    if (idx !== null) {
      segments.push({
        id: segmentId(idx),
        meetingId: input.meetingId,
        idx,
        speakerLabel: null,
        participantId: turn.participantId,
        startMs: turn.startMs,
        endMs: null,
        text,
        origin: "paste",
        edited: false,
      });
    }
    if (turn.warning !== null) {
      warnings.push({
        code: turn.warning,
        line: turn.line,
        segmentIdx: idx,
        speaker: turn.speaker,
      });
    }
  }

  return { segments, warnings };
}
