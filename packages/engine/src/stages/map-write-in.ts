import { loadPrompt, stageConfig, writeInOutput } from "@forkcheck/ai";
import type { Drop, MapWriteInInput, Stages } from "../contracts";

export const MAP_WRITE_IN_PROMPT_VERSION = 1;

const label = (i: number) => String.fromCharCode(65 + i);

export function mapWriteInUserMessage({ probe, text }: MapWriteInInput): string {
  return [
    `Question: ${probe.stem}`,
    ...probe.options.map((o, i) => `${label(i)}. ${o.text}`),
    "",
    `Their answer: ${text.trim()}`,
  ].join("\n");
}

/**
 * One option ID or null (unmapped). Divergence counts a mapped write-in as that option and
 * lists an unmapped one without counting it; the app shows every mapping as model-made.
 */
export const mapWriteIn: Stages["mapWriteIn"] = async (input, model) => {
  const prompt = loadPrompt("mapWriteIn", MAP_WRITE_IN_PROMPT_VERSION);
  const drops: Drop[] = [];
  if (input.text.trim() === "") {
    drops.push({ reason: "empty_write_in", item: input.text });
    return {
      output: { mappedOptionId: null, mappedByModel: true },
      trace: { stage: "mapWriteIn", promptVersion: prompt.version, calls: [], drops },
    };
  }

  const { output, call } = await model.call({
    stage: "mapWriteIn",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.mapWriteIn.reasoningEffort,
    schema: writeInOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: mapWriteInUserMessage(input) },
    ],
  });

  let mappedOptionId: string | null = null;
  if (output.optionId !== null) {
    const letter = output.optionId
      .trim()
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase();
    const option = letter.length === 1 ? input.probe.options[letter.charCodeAt(0) - 65] : undefined;
    if (option) mappedOptionId = option.id;
    else drops.push({ reason: "unknown_option", item: output });
  }

  return {
    output: { mappedOptionId, mappedByModel: true },
    trace: { stage: "mapWriteIn", promptVersion: prompt.version, calls: [call], drops },
  };
};
