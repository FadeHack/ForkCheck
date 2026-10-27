import { normalizeQuote, type Probe } from "@forkcheck/core";
import { loadPrompt, probesOutput, stageConfig } from "@forkcheck/ai";
import type { Drop, GenerateProbesInput, Stages } from "../contracts";
import { decisionBlock, meetingHeader } from "./format";

export const GENERATE_PROBES_PROMPT_VERSION = 1;

export function generateProbesUserMessage({
  meeting,
  participants,
  decision,
  candidate,
}: GenerateProbesInput): string {
  return [
    ...meetingHeader(meeting),
    `Participants: ${participants.map((p) => p.displayName).join(", ")}`,
    "",
    "Item, as [item ID] (kind, status) statement",
    ...decisionBlock(decision),
    "",
    `Dimension: ${candidate.dimension}`,
    "Readings participants might hold:",
    ...candidate.readings.map((r) => `- ${r.text}`),
  ].join("\n");
}

const fold = (s: string) => normalizeQuote(s).toLowerCase();

// "Not sure" is an answer choice the app always offers, so a model-written one would
// show twice and would be counted as a definite answer.
const NOT_SURE =
  /^(?:not sure|unsure|i'?m not sure|don'?t know|i don'?t know|no idea|not decided(?: yet)?|undecided|other|none of (?:these|the above)|can'?t say)\W*$/;
export const isNotSureOption = (text: string) => NOT_SURE.test(fold(text).trim());

export const generateProbes: Stages["generateProbes"] = async (input, model) => {
  // T0 is templated without a model and T1 arrives in M3.3.
  if (input.tier !== "free") throw new Error(`generateProbes supports tier "free" only`);
  const prompt = loadPrompt("generateProbes", GENERATE_PROBES_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "generateProbes",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.generateProbes.reasoningEffort,
    schema: probesOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: generateProbesUserMessage(input) },
    ],
  });

  const drops: Drop[] = [];
  const probes: Probe[] = [];

  for (const draft of output.probes) {
    const stem = draft.stem.trim();
    if (stem === "") {
      drops.push({ reason: "empty_stem", item: draft });
      continue;
    }
    const texts: string[] = [];
    for (const o of draft.options) {
      const t = o.text.trim();
      if (t === "") continue;
      if (isNotSureOption(t)) {
        drops.push({ reason: "model_not_sure_option", item: o });
        continue;
      }
      if (!texts.some((x) => fold(x) === fold(t))) texts.push(t);
    }

    // Option count and length are left to lint, so a weak probe is reported, not hidden.
    const id = `${input.candidate.id}:probe:${probes.length}`;
    probes.push({
      id,
      meetingId: input.meeting.id,
      kind: "diagnostic",
      candidateId: input.candidate.id,
      splitId: null,
      tier: input.tier,
      stem,
      options: texts.map((text, k) => ({ id: `${id}:opt:${k}`, text })),
      lint: [],
      promptVersion: prompt.version,
      status: "draft",
    });
  }

  return {
    output: { probes },
    trace: { stage: "generateProbes", promptVersion: prompt.version, calls: [call], drops },
  };
};
