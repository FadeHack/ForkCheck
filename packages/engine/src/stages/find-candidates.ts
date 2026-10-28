import { normalizeQuote, type Candidate } from "@forkcheck/core";
import { candidatesOutput, loadPrompt, stageConfig } from "@forkcheck/ai";
import type { Drop, FindCandidatesInput, Stages } from "../contracts";
import { decisionBlock, meetingHeader, transcriptLines } from "./format";

export const FIND_CANDIDATES_PROMPT_VERSION = 2;

export function findCandidatesUserMessage({
  meeting,
  participants,
  segments,
  decisions,
}: FindCandidatesInput): string {
  return [
    ...meetingHeader(meeting),
    `Participants: ${participants.map((p) => p.displayName).join(", ")}`,
    "",
    "Items, as [item ID] (kind, status) statement",
    ...decisions.flatMap(decisionBlock),
    "",
    "Transcript, one turn per line as [segment ID] speaker: text",
    ...transcriptLines(segments, participants),
  ].join("\n");
}

const fold = (s: string) => normalizeQuote(s).toLowerCase();

export const findCandidates: Stages["findCandidates"] = async (input, model) => {
  const prompt = loadPrompt("findCandidates", FIND_CANDIDATES_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "findCandidates",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.findCandidates.reasoningEffort,
    schema: candidatesOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: findCandidatesUserMessage(input) },
    ],
  });

  const byId = new Map(input.decisions.map((d) => [d.decision.id, d.decision]));
  const seen = new Set<string>();
  const drops: Drop[] = [];
  const candidates: Candidate[] = [];

  for (const draft of output.candidates) {
    const decision = byId.get(draft.decisionId);
    if (!decision) {
      drops.push({ reason: "unknown_decision", item: draft });
      continue;
    }
    if (decision.status === "debated") {
      drops.push({ reason: "debated_decision", item: draft });
      continue;
    }
    const pair = `${decision.id}\u0000${draft.dimension}`;
    if (seen.has(pair)) {
      drops.push({ reason: "duplicate_dimension", item: draft });
      continue;
    }
    const texts: string[] = [];
    for (const r of draft.readings) {
      const t = r.text.trim();
      if (t !== "" && !texts.some((x) => fold(x) === fold(t))) texts.push(t);
    }
    if (texts.length < 2) {
      drops.push({ reason: "fewer_than_two_readings", item: draft });
      continue;
    }

    seen.add(pair);
    const id = `${input.meeting.id}:cand:${candidates.length}`;
    candidates.push({
      id,
      decisionId: decision.id,
      dimension: draft.dimension,
      readings: texts.map((text, j) => ({ id: `${id}:r:${j}`, text })),
      impact: draft.impact,
    });
  }

  return {
    output: { candidates },
    trace: { stage: "findCandidates", promptVersion: prompt.version, calls: [call], drops },
  };
};
