import type { ReasoningEffort, StageName } from "./port";

export interface StageConfig {
  reasoningEffort: ReasoningEffort;
  /** Includes reasoning tokens, so it must leave room for them. */
  maxCompletionTokens: number;
}

// M0.4 measured about 2,000 reasoning tokens for a trivial call at medium; low used 300–700.
export const stageConfig: Record<StageName, StageConfig> = {
  extract: { reasoningEffort: "medium", maxCompletionTokens: 16_000 },
  findCandidates: { reasoningEffort: "medium", maxCompletionTokens: 16_000 },
  generateProbes: { reasoningEffort: "medium", maxCompletionTokens: 12_000 },
  critique: { reasoningEffort: "low", maxCompletionTokens: 6_000 },
  mapWriteIn: { reasoningEffort: "low", maxCompletionTokens: 4_000 },
  draftResolution: { reasoningEffort: "low", maxCompletionTokens: 4_000 },
  generateRecheck: { reasoningEffort: "medium", maxCompletionTokens: 12_000 },
  draftRecordProse: { reasoningEffort: "low", maxCompletionTokens: 8_000 },
  simulateAnswer: { reasoningEffort: "low", maxCompletionTokens: 4_000 },
};
