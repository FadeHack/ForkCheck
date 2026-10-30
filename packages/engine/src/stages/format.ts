import type { Participant, Segment } from "@forkcheck/core";
import type { DecisionWithEvidence, MeetingContext } from "../contracts";

export function speakerName(segment: Segment, participants: Participant[]): string {
  const p = participants.find((x) => x.id === segment.participantId);
  if (p) return p.displayName;
  // Named so an owner taken from an unmapped voice reads as one, not as a participant.
  return segment.speakerLabel ? `Speaker ${segment.speakerLabel} (unmapped)` : "Unknown";
}

/** Title and local date, so the model can tell which days are near. */
export function meetingHeader(meeting: MeetingContext): string[] {
  const held = new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(meeting.heldAt));
  return [`Meeting: ${meeting.title}`, `Held: ${held} (${meeting.timezone})`];
}

export function transcriptLines(segments: Segment[], participants: Participant[]): string[] {
  return segments.map(
    (s) => `[${s.id}] ${speakerName(s, participants)}: ${s.text.replace(/\n/g, " ")}`,
  );
}

/** One item with its ID, status and supporting quotes. */
export function decisionBlock({ decision, evidence }: DecisionWithEvidence): string[] {
  const fields = [
    `[${decision.id}] (${decision.kind}, ${decision.status}) ${decision.statement}`,
    decision.ownerText !== null ? `  owner: ${decision.ownerText}` : null,
    decision.deadlineText !== null ? `  deadline: ${decision.deadlineText}` : null,
    ...evidence.map((e) => `  quote: "${e.quote}"`),
  ];
  return fields.filter((f) => f !== null);
}
