import { loadPrompt, resolutionDraftOutput, stageConfig } from "@forkcheck/ai";
import type { DraftResolutionInput, Stages } from "../contracts";
import { decisionBlock } from "./format";

export const DRAFT_RESOLUTION_PROMPT_VERSION = 1;

/** Leaves out who answered what and how many chose each option, so a draft can't side with a majority. */
export function draftResolutionUserMessage({
  decision,
  probe,
  answers,
}: DraftResolutionInput): string {
  const writeIns = answers
    .filter((a) => a.choice === "write_in" && a.writeInText !== null)
    .map((a) => `- ${a.writeInText!.trim()}`);
  return [
    "Item, as [item ID] (kind, status) statement",
    ...decisionBlock(decision),
    "",
    `Question: ${probe.stem}`,
    ...probe.options.map((o) => `- ${o.text}`),
    ...(writeIns.length > 0 ? ["", "Answers written in their own words:", ...writeIns] : []),
  ].join("\n");
}

/** Wording only. Nothing is saved: a participant has to submit the text as their proposal. */
export const draftResolution: Stages["draftResolution"] = async (input, model) => {
  const prompt = loadPrompt("draftResolution", DRAFT_RESOLUTION_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "draftResolution",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.draftResolution.reasoningEffort,
    schema: resolutionDraftOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: draftResolutionUserMessage(input) },
    ],
  });
  return {
    output: { text: output.text.trim(), draftedByModel: true },
    trace: { stage: "draftResolution", promptVersion: prompt.version, calls: [call], drops: [] },
  };
};
