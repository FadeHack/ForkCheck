import { resolveDatePhrase } from "./dates";
import type { Candidate, Decision, Meeting, Participant, Probe, Segment } from "./model/index";
import { lintProbe, PROBE_LINT_DEFAULTS } from "./probe-lint";

// R§6.2 tier T0: fixed stems and options built in code, so no model can lean the wording.

export const TEMPLATE_PROMPT_VERSION = "template.v1";

export interface TemplateInput {
  meeting: Pick<Meeting, "id" | "heldAt" | "timezone">;
  participants: readonly Pick<Participant, "id" | "displayName" | "status">[];
  decision: Pick<Decision, "id" | "status" | "statement" | "ownerText" | "deadlineText">;
  candidate: Pick<Candidate, "id" | "dimension" | "readings">;
  /** Transcript turns, for the verbatim-speaker lint rule. */
  segments: readonly Pick<Segment, "text">[];
}

export const FIRMNESS_OPTIONS = ["Still on time", "Late but acceptable", "A missed commitment"];
export const NO_OWNER_OPTION = "No one is named yet";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The item as a clause: no trailing full stop, so it can sit inside a quoted stem. */
function task(statement: string): string {
  return statement.trim().replace(/[.!]+$/, "");
}

/**
 * Replaces participants' names with "someone", then "someone else", so an owner question
 * does not name its answer.
 */
export function withoutNames(text: string, names: readonly string[]): string {
  if (names.length === 0) return text;
  const anyName = new RegExp(`\\b(?:${names.map(escape).join("|")})\\b`, "g");
  let n = 0;
  const out = text.replace(anyName, () => (n++ === 0 ? "someone" : "someone else"));
  return out.startsWith("someone") ? `S${out.slice(1)}` : out;
}

/** Removes the deadline phrase and the preposition in front of it, if the statement contains it. */
function withoutDeadline(text: string, deadline: string): string {
  const phrase = new RegExp(`\\s*(?:\\b(?:by|on|before|until)\\s+)?${escape(deadline)}`, "i");
  return text
    .replace(phrase, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

const LEADING_PREPOSITION = /^(?:by|on|before|until)\s+/i;

/** A single resolved date as "Friday, November 6"; the phrase as said when it has no single reading. */
export function deadlineWords(phrase: string, heldAt: string, timezone: string): string {
  const readings = resolveDatePhrase(phrase, heldAt, timezone);
  if (readings.length !== 1) return `"${phrase.trim().replace(LEADING_PREPOSITION, "")}"`;
  return new Date(`${readings[0]!.date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Owner options: participants named in the readings or the stated owner first, then the
 * rest in meeting order, up to one below the option limit; then "No one is named yet",
 * and a shared option when only two people are in the room.
 */
export function ownerOptions(
  input: Pick<TemplateInput, "participants" | "decision" | "candidate">,
): string[] {
  const active = input.participants.filter((p) => p.status === "active");
  const said = [
    input.decision.ownerText ?? "",
    ...input.candidate.readings.map((r) => r.text),
  ].join("\n");
  const mentioned = (p: (typeof active)[number]) =>
    new RegExp(`\\b${escape(p.displayName)}\\b`).test(said);
  const ranked = [...active.filter(mentioned), ...active.filter((p) => !mentioned(p))];
  const names = ranked.slice(0, PROBE_LINT_DEFAULTS.maxOptions - 1).map((p) => p.displayName);
  const options = [...names.map((n) => `${n} does it`), NO_OWNER_OPTION];
  if (active.length === 2) options.push(`${names[0]} and ${names[1]} share it`);
  return options;
}

function build(input: TemplateInput, stem: string, texts: readonly string[]): Probe {
  const id = `${input.candidate.id}:t0`;
  const options = texts.map((text, k) => ({ id: `${id}:opt:${k}`, text }));
  return {
    id,
    meetingId: input.meeting.id,
    kind: "diagnostic",
    candidateId: input.candidate.id,
    splitId: null,
    tier: "template",
    stem,
    options,
    lint: lintProbe(
      { stem, options },
      {
        targets: [{ decision: input.decision, dimension: input.candidate.dimension }],
        segments: input.segments,
      },
    ),
    promptVersion: TEMPLATE_PROMPT_VERSION,
    status: "draft",
  };
}

/** "Who does [task] on the day it happens?" with the participants as options. */
export function ownerTemplate(input: TemplateInput): Probe {
  const names = input.participants.map((p) => p.displayName);
  const item = withoutNames(task(input.decision.statement), names);
  return build(input, `For "${item}", who does it on the day it happens?`, ownerOptions(input));
}

/** "If [task] lands two working days after [date], that is…"; null without a deadline phrase. */
export function deadlineFirmnessTemplate(input: TemplateInput): Probe | null {
  const deadline = input.decision.deadlineText?.trim();
  if (!deadline) return null;
  const item = withoutDeadline(task(input.decision.statement), deadline);
  const when = deadlineWords(deadline, input.meeting.heldAt, input.meeting.timezone);
  return build(
    input,
    `For "${item}", if it lands two working days after ${when}, how does that count?`,
    FIRMNESS_OPTIONS,
  );
}

/**
 * The T0 probe for a candidate: owner and deadline firmness only. Null for other dimensions
 * or a deadline candidate with no deadline phrase. The probe carries its lint findings; the
 * caller drops one that has any.
 */
export function templateProbe(input: TemplateInput): Probe | null {
  switch (input.candidate.dimension) {
    case "owner":
      return ownerTemplate(input);
    case "deadline":
      return deadlineFirmnessTemplate(input);
    default:
      return null;
  }
}
