import { loadPrompt, simulateOutput, stageConfig } from "@forkcheck/ai";
import type { Drop, SimulateAnswerInput, SimulateAnswerOutput, Stages } from "../contracts";

export const SIMULATE_ANSWER_PROMPT_VERSION = 1;

// Letters, not option IDs: IDs carry the generation order, which the shuffle hides.
const label = (i: number) => String.fromCharCode(65 + i);

/** Built from this participant's brief and the probe only; no other brief can reach it. */
export function simulateAnswerUserMessage({ brief, probe }: SimulateAnswerInput): string {
  return [
    "Your private notes on what the meeting agreed, as (item, dimension) note:",
    ...brief.readings.map((r) => `- (${r.decisionId}, ${r.dimension}) ${r.reading}`),
    "",
    `Question: ${probe.stem}`,
    ...probe.options.map((o, i) => `${label(i)}. ${o.text}`),
  ].join("\n");
}

export const simulateAnswer: Stages["simulateAnswer"] = async (input, model) => {
  const prompt = loadPrompt("simulateAnswer", SIMULATE_ANSWER_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "simulateAnswer",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.simulateAnswer.reasoningEffort,
    schema: simulateOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: simulateAnswerUserMessage(input) },
    ],
  });

  const drops: Drop[] = [];
  let answer: SimulateAnswerOutput["answer"] = { choice: "unsure", optionId: null };
  if (output.optionId !== null) {
    const letter = output.optionId
      .trim()
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase();
    const index = letter.length === 1 ? letter.charCodeAt(0) - 65 : -1;
    const option = input.probe.options[index];
    if (option) answer = { choice: "option", optionId: option.id };
    else drops.push({ reason: "unknown_option", item: output });
  }

  return {
    output: { answer },
    trace: { stage: "simulateAnswer", promptVersion: prompt.version, calls: [call], drops },
  };
};
