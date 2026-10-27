import type { RecordItem } from "@forkcheck/core";
import { loadPrompt, recordProseOutput, stageConfig } from "@forkcheck/ai";
import type { DraftRecordProseInput, Drop, Stages } from "../contracts";

export const DRAFT_RECORD_PROSE_PROMPT_VERSION = 1;

const CATEGORY_HEADINGS: [RecordItem["category"], string][] = [
  ["confirmed", "Confirmed by participants"],
  ["unresolved", "Unresolved"],
  ["stated", "Stated in the meeting"],
];

function itemLine(item: RecordItem, names: Map<string, string>): string {
  const name = (id: string) => names.get(id) ?? id;
  const parts = [`[${item.id}] (${item.category}) ${item.text}`];
  if (item.category === "confirmed") {
    parts.push(`confirmed by ${item.confirmedBy.map(name).join(", ")}`);
    if (item.absent.length > 0)
      parts.push(`absent, not confirmed: ${item.absent.map(name).join(", ")}`);
    parts.push(`recheck: ${item.recheck.replace("_", " ")}`);
  }
  if (item.category === "unresolved" && item.recheck === "failed") parts.push("recheck: failed");
  return parts.join("; ");
}

export function draftRecordProseUserMessage({ record }: DraftRecordProseInput): string {
  const names = new Map(record.participants.map((p) => [p.id, p.displayName]));
  return [
    `Meeting: ${record.title}`,
    `Held: ${record.heldAt}`,
    "",
    "Items, as [item ID] (category) text",
    ...record.items.map((i) => itemLine(i, names)),
  ].join("\n");
}

const numbers = (s: string) => s.match(/\d+/g) ?? [];

/** Numbers in `prose` that `source` never mentions: the model added a detail. */
const addedNumbers = (prose: string, source: string) => {
  const known = new Set(numbers(source).map(Number));
  return numbers(prose).filter((n) => !known.has(Number(n)));
};

const CLAIMS_AGREEMENT = /\b(agreed|confirmed|settled|signed off)\b/i;

/**
 * A draft summary of the record. Prose for an item that is not in the record, that adds a
 * number the item does not have, or that calls a stated or unresolved item agreed is
 * dropped; the record items themselves never change.
 */
export const draftRecordProse: Stages["draftRecordProse"] = async (input, model) => {
  const { record } = input;
  const prompt = loadPrompt("draftRecordProse", DRAFT_RECORD_PROSE_PROMPT_VERSION);
  const { output, call } = await model.call({
    stage: "draftRecordProse",
    promptVersion: prompt.version,
    reasoningEffort: stageConfig.draftRecordProse.reasoningEffort,
    schema: recordProseOutput,
    messages: [
      { role: "developer", content: prompt.text },
      { role: "user", content: draftRecordProseUserMessage(input) },
    ],
  });

  const names = new Map(record.participants.map((p) => [p.id, p.displayName]));
  const source = (item: RecordItem) => itemLine(item, names);
  const drops: Drop[] = [];
  const byId = new Map(record.items.map((i) => [i.id, i]));
  const prose = new Map<string, string>();
  for (const draft of output.items) {
    const item = byId.get(draft.itemId.trim());
    const text = draft.prose.trim();
    if (!item) {
      drops.push({ reason: "unknown_item", item: draft });
    } else if (prose.has(item.id)) {
      drops.push({ reason: "duplicate_item", item: draft });
    } else if (text === "") {
      drops.push({ reason: "empty_prose", item: draft });
    } else if (addedNumbers(text, source(item)).length > 0) {
      drops.push({ reason: "added_detail", item: draft });
    } else if (item.category !== "confirmed" && CLAIMS_AGREEMENT.test(text)) {
      drops.push({ reason: "claims_agreement", item: draft });
    } else {
      prose.set(item.id, text);
    }
  }

  const everything = [record.title, record.heldAt, ...record.items.map(source)].join("\n");
  let summary = output.summary.trim();
  if (addedNumbers(summary, everything).length > 0) {
    drops.push({ reason: "added_detail", item: { summary } });
    summary = "";
  }

  const sections = CATEGORY_HEADINGS.flatMap(([category, heading]) => {
    const lines = record.items.flatMap((i) =>
      i.category === category && prose.has(i.id) ? [`- ${prose.get(i.id)}`] : [],
    );
    return lines.length > 0 ? [`${heading}\n${lines.join("\n")}`] : [];
  });

  return {
    output: { prose: [summary, ...sections].filter((x) => x !== "").join("\n\n") },
    trace: { stage: "draftRecordProse", promptVersion: prompt.version, calls: [call], drops },
  };
};
