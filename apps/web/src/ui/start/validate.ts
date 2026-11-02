import { normalizeName, parseTranscript } from "@forkcheck/core";
import type { CreateMeetingRequest } from "../../contracts/api";
import type { ValidationError } from "../../server/http";
import { recordingProblem, termList, type RecordingInfo } from "../audio";
import { wallTimeToInstant } from "../time";

export type FormField =
  "title" | "heldAt" | "timezone" | "participants" | "transcript" | "recording" | "consent";
export type FieldErrors = Partial<Record<FormField, string>>;

export type SourceKind = "paste" | "audio";

export interface MeetingForm {
  title: string;
  heldAt: string;
  timezone: string;
  participants: string;
  /** Paste when absent. */
  source?: SourceKind;
  /** Paste only. */
  transcript: string;
  /** Audio only: the chosen file, or null when none is. */
  recording?: RecordingInfo | null;
  /** Audio only: project terms for recognition, one per line. */
  terms?: string;
  /** Placeholders instead of names in every model request. */
  pseudonymizeNames?: boolean;
  consent: boolean;
}

// Each message names the field and says what to do, so the server's own wording is never shown.
const FIX: Record<FormField, string> = {
  title: "Enter a meeting title.",
  heldAt: "Enter the date and time the meeting started, in the time zone below.",
  timezone: "Enter a time zone name, such as America/New_York.",
  participants: "Enter at least two participant names, one per line.",
  transcript: "Paste the meeting transcript.",
  recording: "Choose the recording to upload.",
  consent: "Confirm that everyone agreed to have this meeting checked.",
};

export function participantNames(text: string): string[] {
  return text
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function repeatedName(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    const key = normalizeName(name);
    if (seen.has(key)) return name;
    seen.add(key);
  }
  return null;
}

export function validateMeeting(
  form: MeetingForm,
):
  | { ok: true; body: CreateMeetingRequest; keywords: string[] }
  | { ok: false; errors: FieldErrors } {
  const audio = form.source === "audio";
  const title = form.title.trim();
  const timezone = form.timezone.trim();
  const participants = participantNames(form.participants);
  const transcript = form.transcript.trim();
  const errors: FieldErrors = {};

  if (title === "") errors.title = FIX.title;
  const zoneOk = timezone !== "" && isTimeZone(timezone);
  if (!zoneOk) errors.timezone = FIX.timezone;
  // Without a valid zone the time can't be read, and the zone's error already says why.
  const heldAt = zoneOk ? wallTimeToInstant(form.heldAt.trim(), timezone) : null;
  if (zoneOk && heldAt === null) errors.heldAt = FIX.heldAt;
  const repeated = repeatedName(participants);
  if (participants.length < 2) errors.participants = FIX.participants;
  else if (repeated !== null) {
    errors.participants = `Each participant needs a different name. "${repeated}" is listed twice.`;
  }
  if (audio) {
    const problem = recordingProblem(form.recording ?? null);
    if (problem !== null) errors.recording = problem;
  } else if (transcript === "") errors.transcript = FIX.transcript;
  if (!form.consent) errors.consent = FIX.consent;

  if (Object.keys(errors).length > 0 || heldAt === null) return { ok: false, errors };
  const base = { title, heldAt, timezone, participants };
  const body = form.pseudonymizeNames ? { ...base, pseudonymizeNames: true } : base;
  return audio
    ? { ok: true, body, keywords: termList(form.terms ?? "") }
    : { ok: true, body: { ...body, transcript }, keywords: [] };
}

/** Maps a 400's `participants.1` style paths onto the form's fields. */
export function serverFieldErrors(body: unknown): FieldErrors {
  const fields = (body as ValidationError | null)?.error?.fields ?? {};
  const out: FieldErrors = {};
  for (const path of Object.keys(fields)) {
    const key = path.split(".")[0] as FormField;
    if (key in FIX && key !== "consent") out[key] = FIX[key];
  }
  return out;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function lineList(lines: number[]): string {
  if (lines.length === 1) return `Line ${lines[0]}`;
  return `Lines ${lines.slice(0, -1).join(", ")} and ${lines.at(-1)}`;
}

/** Problems the server would accept but the organizer should see: lines it can't attribute. */
export function transcriptWarnings(participantsText: string, transcript: string): string[] {
  const names = participantNames(participantsText);
  if (names.length === 0 || transcript.trim() === "") return [];
  const { warnings } = parseTranscript({
    meetingId: "draft",
    text: transcript,
    participants: names.map((displayName, i) => ({ id: String(i), displayName })),
  });

  const out: string[] = [];
  const unknown = warnings.filter((w) => w.code === "unknown_speaker");
  if (unknown.length > 0) {
    const speakers = [...new Set(unknown.map((w) => w.speaker!))];
    const plural = speakers.length > 1;
    out.push(
      `${count(unknown.length, "line starts", "lines start")} with ${plural ? "names that aren't" : "a name that isn't"} in the participant list: ${speakers.join(", ")}. Add ${plural ? "them" : "it"} or fix the ${plural ? "names" : "name"}.`,
    );
  }
  // Named as the participant list spells it, not as the transcript line does.
  const listed = new Map<string, string>();
  for (const n of names) if (!listed.has(normalizeName(n))) listed.set(normalizeName(n), n);
  const ambiguous = [
    ...new Set(
      warnings
        .filter((w) => w.code === "ambiguous_speaker")
        .map((w) => listed.get(normalizeName(w.speaker!))!),
    ),
  ];
  for (const speaker of ambiguous) {
    out.push(
      `${speaker} is listed more than once in the participant list, so their lines can't be matched. Give each person a different name.`,
    );
  }
  const missing = warnings.filter((w) => w.code === "missing_speaker").map((w) => w.line);
  if (missing.length > 0) {
    out.push(
      `${lineList(missing)} ${missing.length === 1 ? "has" : "have"} no speaker name. Start ${missing.length === 1 ? "it" : "each"} with the speaker's name, like "Dana: text".`,
    );
  }
  return out;
}
