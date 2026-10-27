import { critiqueOutput, loadPrompt, stageConfig } from "@forkcheck/ai";
import type { CritiqueInput, Stages } from "../contracts";

export const CRITIQUE_PROMPT_VERSION = 1;

export function critiqueUserMessage({ candidate, probe }: CritiqueInput): string {
  return [
    `Dimension: ${candidate.dimension}`,
    "Readings participants might hold:",
    ...candidate.readings.map((r) => `- ${r.text}`),
    "",
    `Question: ${probe.stem}`,
    ...probe.options.map((o, i) => `${i} ${o.text}`),
  ].join("\n");
}

/** R§6.3 critic: the probe passes only if readings can diverge and no option leads. */
export const critique: Stages["critique"] = async (input, model) => {
  const prompt = loadPrompt("critique", CRITIQUE_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "critique",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.critique.reasoningEffort,
    schema: critiqueOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: critiqueUserMessage(input) },
    ],
  });

  const { options } = input.probe;
  const leading =
    output.leadingOption !== null &&
    Number.isInteger(output.leadingOption) &&
    output.leadingOption >= 0 &&
    output.leadingOption < options.length
      ? options[output.leadingOption]!
      : null;
  const reasons: string[] = [];
  if (!output.canDiverge) reasons.push("Readings would not lead to different options.");
  if (leading) reasons.push(`Option "${leading.text}" looks like the right answer.`);
  const reason = output.reason.trim();
  if (reasons.length > 0 && reason !== "") reasons.push(reason);

  return {
    output: { pass: reasons.length === 0, reasons },
    trace: { stage: "critique", promptVersion: prompt.version, calls: [call], drops: [] },
  };
};
