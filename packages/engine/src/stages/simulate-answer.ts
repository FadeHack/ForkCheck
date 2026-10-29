import { loadPrompt, simulateOutput, stageConfig } from "@forkcheck/ai";
import type { Drop, SimulateAnswerInput, SimulateAnswerOutput, Stages } from "../contracts";

export const SIMULATE_ANSWER_PROMPT_VERSION = 1;

// Letters, not option IDs: IDs carry the generation order, which the shuffle hides.
const label = (i: number) => String.fromCharCode(65 + i);

/**
 * Added to a participant's notes for a recheck: a precise resolution overrides their old
 * understanding; where a vague one leaves a point open, they fill it with their own.
 */
export const confirmedResolutionNote = (resolutionText: string) =>
  `Everyone then confirmed: "${resolutionText}". Wherever it is specific, it replaces your understanding above; on any point it leaves open, you keep your understanding.`;

/** Built from this participant's brief and the probe only; no other brief can reach it. */
export function simulateAnswerUserMessage({ brief, probe }: SimulateAnswerInput): string {
  // Notes from the app have no item keys; the eval's keyed readings keep their recorded wording.
  const notes =
    brief.notes === undefined
      ? [
          "Your private notes on what the meeting agreed, as (item, dimension) note:",
          ...brief.readings.map((r) => `- (${r.decisionId}, ${r.dimension}) ${r.reading}`),
        ]
      : ["Your private notes on what the meeting agreed:", brief.notes];
  return [
    ...notes,
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
