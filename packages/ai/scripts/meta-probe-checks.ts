import { z } from "zod";
import { META_CHAT_MODEL, META_CHAT_PRICE, META_TRANSCRIBE_MODEL } from "../src/models";

export const probeOutput = z.strictObject({
  decision: z.string().min(1),
  owner: z.string().nullable(),
  due_kind: z.enum(["date", "relative", "vague", "none"]),
});

export const probeJsonSchema = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(probeOutput);
  return schema;
})();

export const probeMessages = [
  {
    role: "developer" as const,
    content:
      "Extract the single decision from the meeting excerpt. owner is the person responsible, or null if nobody was named. due_kind says how the deadline was stated.",
  },
  {
    role: "user" as const,
    content: "Priya: OK, so we ship the pricing page by Friday. Marco, can you own the copy?",
  },
];

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export function checkModelList(ids: readonly string[]): Check {
  const missing = [META_CHAT_MODEL, META_TRANSCRIBE_MODEL].filter((id) => !ids.includes(id));
  return {
    name: "model list",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${ids.length} models, both required present`
        : `missing ${missing.join(", ")}`,
  };
}

export function checkOutput(content: string | null | undefined, finishReason: string): Check[] {
  const checks: Check[] = [
    { name: "finish reason", ok: finishReason === "stop", detail: finishReason },
  ];
  let json: unknown;
  try {
    json = JSON.parse(content ?? "");
  } catch {
    checks.push({ name: "JSON parse", ok: false, detail: "content is not JSON" });
    return checks;
  }
  checks.push({ name: "JSON parse", ok: true, detail: "ok" });
  const parsed = probeOutput.safeParse(json);
  checks.push({
    name: "Zod schema (first try)",
    ok: parsed.success,
    detail: parsed.success ? "ok" : parsed.error.issues.map((i) => i.path.join(".")).join(", "),
  });
  return checks;
}

export function estimateCostUsd(usage: {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number | undefined;
}): number {
  const cached = usage.cached_tokens ?? 0;
  return (
    ((usage.prompt_tokens - cached) * META_CHAT_PRICE.input +
      cached * META_CHAT_PRICE.cachedInput +
      usage.completion_tokens * META_CHAT_PRICE.output) /
    1_000_000
  );
}
