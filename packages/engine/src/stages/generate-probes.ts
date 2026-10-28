import { assistedStem, normalizeQuote, type Probe } from "@forkcheck/core";
import { assistedOptionsOutput, loadPrompt, probesOutput, stageConfig } from "@forkcheck/ai";
import type {
  Drop,
  GenerateProbesInput,
  GenerateProbesOutput,
  ModelPort,
  StageResult,
  Stages,
} from "../contracts";
import { decisionBlock, meetingHeader } from "./format";

export const GENERATE_PROBES_PROMPT_VERSION = 1;
export const GENERATE_PROBES_ASSISTED_PROMPT_VERSION = 1;

/** A rejected probe and what was wrong with it, sent back once for a rewrite. */
export interface ProbeFeedback {
  probe: Pick<Probe, "stem" | "options">;
  problems: string[];
}

export function generateProbesUserMessage(
  { meeting, participants, decision, candidate }: GenerateProbesInput,
  feedback?: ProbeFeedback,
): string {
  const lines = [
    ...meetingHeader(meeting),
    `Participants: ${participants.map((p) => p.displayName).join(", ")}`,
    "",
    "Item, as [item ID] (kind, status) statement",
    ...decisionBlock(decision),
    "",
    `Dimension: ${candidate.dimension}`,
    "Readings participants might hold:",
    ...candidate.readings.map((r) => `- ${r.text}`),
  ];
  if (feedback) {
    lines.push(
      "",
      "An earlier question for this gap was rejected:",
      `Question: ${feedback.probe.stem}`,
      ...feedback.probe.options.map((o) => `- ${o.text}`),
      "Problems:",
      ...feedback.problems.map((p) => `- ${p}`),
      "Write a new question that fixes every problem.",
    );
  }
  return lines.join("\n");
}

const fold = (s: string) => normalizeQuote(s).toLowerCase();

// "Not sure" is an answer choice the app always offers, so a model-written one would
// show twice and would be counted as a definite answer.
const NOT_SURE =
  /^(?:not sure|unsure|i'?m not sure|don'?t know|i don'?t know|no idea|not decided(?: yet)?|undecided|other|none of (?:these|the above)|can'?t say)\W*$/;
export const isNotSureOption = (text: string) => NOT_SURE.test(fold(text).trim());

export const generateProbes: Stages["generateProbes"] = (input, model) =>
  generateProbesWith(input, model);

/** Trims options, drops model-written "not sure" options and duplicates, assigns IDs. */
function toProbe(
  input: GenerateProbesInput,
  stem: string,
  options: readonly { text: string }[],
  index: number,
  promptVersion: string,
  drops: Drop[],
): Probe {
  const texts: string[] = [];
  for (const o of options) {
    const t = o.text.trim();
    if (t === "") continue;
    if (isNotSureOption(t)) {
      drops.push({ reason: "model_not_sure_option", item: o });
      continue;
    }
    if (!texts.some((x) => fold(x) === fold(t))) texts.push(t);
  }
  // Option count and length are left to lint, so a weak probe is reported, not hidden.
  const id = `${input.candidate.id}:probe:${index}`;
  return {
    id,
    meetingId: input.meeting.id,
    kind: "diagnostic",
    candidateId: input.candidate.id,
    splitId: null,
    tier: input.tier,
    stem,
    options: texts.map((text, k) => ({ id: `${id}:opt:${k}`, text })),
    lint: [],
    promptVersion,
    status: "draft",
  };
}

export function assistedOptionsUserMessage(
  input: GenerateProbesInput,
  stem: string,
  feedback?: ProbeFeedback,
): string {
  const lines = [...generateProbesUserMessage(input).split("\n"), "", `Fixed question: ${stem}`];
  if (feedback) {
    lines.push(
      "",
      "Earlier options for this question were rejected:",
      ...feedback.probe.options.map((o) => `- ${o.text}`),
      "Problems:",
      ...feedback.problems.map((p) => `- ${p}`),
      "Write new options that fix every problem.",
    );
  }
  return lines.join("\n");
}

/** Tier T1: the stem comes from code; the model writes only the options. */
async function generateAssisted(
  input: GenerateProbesInput,
  model: ModelPort,
  feedback?: ProbeFeedback,
): Promise<StageResult<GenerateProbesOutput>> {
  const prompt = loadPrompt("generateProbesAssisted", GENERATE_PROBES_ASSISTED_PROMPT_VERSION);
  const stem = assistedStem({
    meeting: input.meeting,
    decision: input.decision.decision,
    candidate: input.candidate,
  });
  if (stem === null) {
    return {
      output: { probes: [] },
      trace: {
        stage: "generateProbes",
        promptVersion: prompt.version,
        calls: [],
        drops: [{ reason: "no_assisted_stem", item: input.candidate }],
      },
    };
  }
  const { output, call } = await model.call({
    stage: "generateProbes",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.generateProbes.reasoningEffort,
    schema: assistedOptionsOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: assistedOptionsUserMessage(input, stem, feedback) },
    ],
  });
  const drops: Drop[] = [];
  // An empty list is the model declining: the readings do not separate under this stem.
  const probes =
    output.options.length === 0
      ? []
      : [toProbe(input, stem, output.options, 0, prompt.version, drops)];
  return {
    output: { probes },
    trace: { stage: "generateProbes", promptVersion: prompt.version, calls: [call], drops },
  };
}

/** The stage, plus optional feedback on a rejected probe for the one rewrite. */
export async function generateProbesWith(
  input: GenerateProbesInput,
  model: ModelPort,
  feedback?: ProbeFeedback,
): Promise<StageResult<GenerateProbesOutput>> {
  // T0 needs no model: core's templateProbe builds it.
  if (input.tier === "template") throw new Error(`generateProbes has no "template" tier`);
  if (input.tier === "assisted") return generateAssisted(input, model, feedback);
  const prompt = loadPrompt("generateProbes", GENERATE_PROBES_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "generateProbes",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.generateProbes.reasoningEffort,
    schema: probesOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: generateProbesUserMessage(input, feedback) },
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
    probes.push(toProbe(input, stem, draft.options, probes.length, prompt.version, drops));
  }

  return {
    output: { probes },
    trace: { stage: "generateProbes", promptVersion: prompt.version, calls: [call], drops },
  };
}
