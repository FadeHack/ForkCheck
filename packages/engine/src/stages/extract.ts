import {
  normalizeName,
  normalizeQuote,
  verifyQuote,
  type Decision,
  type Evidence,
  type Participant,
  type Segment,
} from "@forkcheck/core";
import { extractOutput, loadPrompt, stageConfig } from "@forkcheck/ai";
import type { DecisionWithEvidence, Drop, ExtractInput, Stages } from "../contracts";
import { meetingHeader, transcriptLines } from "./format";

export const EXTRACT_PROMPT_VERSION = 1;

export function extractUserMessage({ meeting, participants, segments }: ExtractInput): string {
  return [
    ...meetingHeader(meeting),
    `Participants: ${participants.map((p) => p.displayName).join(", ")}`,
    "",
    "Transcript, one turn per line as [segment ID] speaker: text",
    ...transcriptLines(segments, participants),
  ].join("\n");
}

const fold = (s: string) => normalizeQuote(s).toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, name: string) =>
  name !== "" &&
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(name))}(?![\\p{L}\\p{N}])`, "u").test(fold(text));
// "I'll", "I'm" and friends match on the bare "i" before the apostrophe.
const FIRST_PERSON = /(?<![\p{L}'])(?:i|me|my|mine|myself)(?![\p{L}])/u;

function ownerParticipant(ownerText: string, participants: Participant[]) {
  const owner = normalizeName(ownerText);
  return participants.find((p) => {
    const name = normalizeName(p.displayName);
    return name === owner || name.split(" ")[0] === owner;
  });
}

/**
 * An owner is stated when a quote names them, or when they say a quote themselves in the
 * first person. Anything else the model offers is inferred and never shown as stated.
 */
export function isOwnerStated(
  ownerText: string,
  evidence: { quote: string; segment: Segment }[],
  participants: Participant[],
): boolean {
  const p = ownerParticipant(ownerText, participants);
  return evidence.some(
    ({ quote, segment }) =>
      mentions(quote, ownerText) ||
      (p !== undefined &&
        (mentions(quote, p.displayName) ||
          (segment.participantId === p.id && FIRST_PERSON.test(fold(quote))))),
  );
}

export function isDeadlineStated(deadlineText: string, quotes: string[]): boolean {
  const d = fold(deadlineText);
  return d !== "" && quotes.some((q) => fold(q).includes(d));
}

const blankToNull = (s: string | null) => (s === null || s.trim() === "" ? null : s.trim());

export const extract: Stages["extract"] = async (input, model) => {
  const prompt = loadPrompt("extract", EXTRACT_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "extract",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.extract.reasoningEffort,
    schema: extractOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: extractUserMessage(input) },
    ],
  });

  const byId = new Map(input.segments.map((s) => [s.id, s]));
  const drops: Drop[] = [];
  const decisions: DecisionWithEvidence[] = [];

  for (const draft of output.decisions) {
    const verified: { quote: string; segment: Segment }[] = [];
    for (const ev of draft.evidence) {
      const segment = byId.get(ev.segmentId);
      if (!segment) {
        drops.push({ reason: "evidence_unknown_segment", item: ev });
        continue;
      }
      const match = verifyQuote(segment, ev.quote);
      if (!match.ok) {
        drops.push({ reason: `evidence_${match.reason}`, item: ev });
        continue;
      }
      // Keep the transcript's own characters, not the model's copy of them.
      const quote = segment.text.slice(match.start, match.end);
      if (!verified.some((v) => v.segment.id === segment.id && v.quote === quote)) {
        verified.push({ quote, segment });
      }
    }
    const statement = draft.statement.trim();
    if (verified.length === 0 || statement === "") {
      drops.push({
        reason: statement === "" ? "empty_statement" : "no_verified_evidence",
        item: draft,
      });
      continue;
    }

    const idx = decisions.length;
    const id = `${input.meeting.id}:dec:${idx}`;
    const ownerText = blankToNull(draft.ownerText);
    const deadlineText = blankToNull(draft.deadlineText);
    const decision: Decision = {
      id,
      meetingId: input.meeting.id,
      idx,
      kind: draft.kind,
      statement,
      ownerText,
      deadlineText,
      ownerInferred: ownerText !== null && !isOwnerStated(ownerText, verified, input.participants),
      deadlineInferred:
        deadlineText !== null &&
        !isDeadlineStated(
          deadlineText,
          verified.map((v) => v.quote),
        ),
      status: draft.status,
    };
    const evidence: Evidence[] = verified.map((v, j) => ({
      id: `${id}:ev:${j}`,
      decisionId: id,
      resolutionId: null,
      segmentId: v.segment.id,
      quote: v.quote,
    }));
    decisions.push({ decision, evidence });
  }

  return {
    output: { decisions },
    trace: { stage: "extract", promptVersion: prompt.version, calls: [call], drops },
  };
};
