import { z } from "zod";
import { BASETEN_CHAT_PRICE, BASETEN_MODEL } from "../src/baseten";

// Same task as the Meta chat probe (M0.4), so the two results can be compared.
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
    role: "system" as const,
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
  const listed = ids.includes(BASETEN_MODEL);
  return {
    name: "model list",
    ok: listed,
    detail: listed ? `${ids.length} models, ${BASETEN_MODEL} present` : `missing ${BASETEN_MODEL}`,
  };
}

export function checkHttp(status: number): Check {
  const ok = status >= 200 && status < 300;
  return { name: "chat HTTP status", ok, detail: String(status) };
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
    ((usage.prompt_tokens - cached) * BASETEN_CHAT_PRICE.input +
      cached * BASETEN_CHAT_PRICE.cachedInput +
      usage.completion_tokens * BASETEN_CHAT_PRICE.output) /
    1_000_000
  );
}
