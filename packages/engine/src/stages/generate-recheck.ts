import type { Probe } from "@forkcheck/core";
import { loadPrompt, recheckOutput, stageConfig } from "@forkcheck/ai";
import type {
  Drop,
  GenerateRecheckInput,
  GenerateRecheckOutput,
  ModelPort,
  StageResult,
  Stages,
} from "../contracts";
import { decisionBlock } from "./format";
import { isNotSureOption, type ProbeFeedback } from "./generate-probes";

export const GENERATE_RECHECK_PROMPT_VERSION = 1;

/** The stage output plus the consequence the model chose to ask about, for the trace. */
export interface RecheckDraft extends GenerateRecheckOutput {
  consequence: string;
}

export function generateRecheckUserMessage(
  { decision, originalProbe, resolution }: GenerateRecheckInput,
  feedback?: ProbeFeedback,
): string {
  const lines = [
    "Item, as [item ID] (kind, status) statement",
    ...decisionBlock(decision),
    "",
    "Question that revealed the difference:",
    `Question: ${originalProbe.stem}`,
    ...originalProbe.options.map((o) => `- ${o.text}`),
    "",
    `Confirmed resolution: ${resolution.text}`,
  ];
  if (feedback) {
    lines.push(
      "",
      "An earlier recheck question was rejected:",
      `Question: ${feedback.probe.stem}`,
      ...feedback.probe.options.map((o) => `- ${o.text}`),
      "Problems:",
      ...feedback.problems.map((p) => `- ${p}`),
      "Write a new question that fixes every problem.",
    );
  }
  return lines.join("\n");
}

export const generateRecheck: Stages["generateRecheck"] = (input, model) =>
  generateRecheckWith(input, model);

/** The stage, plus optional feedback on a rejected recheck for the one rewrite. */
export async function generateRecheckWith(
  input: GenerateRecheckInput,
  model: ModelPort,
  feedback?: ProbeFeedback,
): Promise<StageResult<RecheckDraft>> {
  const prompt = loadPrompt("generateRecheck", GENERATE_RECHECK_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "generateRecheck",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.generateRecheck.reasoningEffort,
    schema: recheckOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: generateRecheckUserMessage(input, feedback) },
    ],
  });

  const drops: Drop[] = [];
  const texts: string[] = [];
  for (const o of output.options) {
    const t = o.text.trim();
    if (t === "") continue;
    if (isNotSureOption(t)) {
      drops.push({ reason: "model_not_sure_option", item: o });
      continue;
    }
    if (!texts.some((x) => x.toLowerCase() === t.toLowerCase())) texts.push(t);
  }

  // An empty stem is kept so the caller's lint reports it instead of the probe vanishing.
  const { resolution, originalProbe } = input;
  const id = `${resolution.splitId}:recheck:${resolution.id}`;
  const probe: Probe = {
    id,
    meetingId: originalProbe.meetingId,
    kind: "recheck",
    candidateId: null,
    splitId: resolution.splitId,
    tier: "free",
    stem: output.stem.trim(),
    options: texts.map((text, k) => ({ id: `${id}:opt:${k}`, text })),
    lint: [],
    promptVersion: prompt.version,
    status: "draft",
  };

  return {
    output: { probe, consequence: output.consequence.trim() },
    trace: { stage: "generateRecheck", promptVersion: prompt.version, calls: [call], drops },
  };
}
