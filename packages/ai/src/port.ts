import type { z } from "zod";

export const stageNames = [
  "extract",
  "findCandidates",
  "generateProbes",
  "critique",
  "mapWriteIn",
  "draftResolution",
  "generateRecheck",
  "draftRecordProse",
  "simulateAnswer",
] as const;
export type StageName = (typeof stageNames)[number];

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelMessage {
  role: "developer" | "user" | "assistant";
  content: string;
}

export interface ModelRequest<T> {
  stage: StageName;
  promptVersion: string;
  messages: readonly ModelMessage[];
  schema: z.ZodType<T>;
  reasoningEffort: ReasoningEffort;
}

/** One entry of the `model_call` log (R§5.2). */
export interface ModelCallInfo {
  stage: StageName;
  provider: "meta" | "baseten" | "fake";
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  costUsd: number;
  ok: boolean;
  error: string | null;
}

export interface ModelResponse<T> {
  output: T;
  call: ModelCallInfo;
}

/** What every stage calls. Implemented by the Meta, Baseten and fake providers. */
export interface ModelPort {
  call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>>;
}
