import type {
  Answer,
  Candidate,
  Decision,
  DecisionRecord,
  Dimension,
  Evidence,
  Meeting,
  Participant,
  Probe,
  ProbeTier,
  Resolution,
  Segment,
  Split,
} from "@forkcheck/core";
import type { ModelCallInfo, ModelPort, StageName } from "@forkcheck/ai";

export { stageNames, type ModelPort, type StageName } from "@forkcheck/ai";

/** Something a stage discarded, with the reason, so drops are visible in the trace. */
export interface Drop {
  reason: string;
  item: unknown;
}

export interface StageTrace {
  stage: StageName;
  promptVersion: string;
  calls: ModelCallInfo[];
  drops: Drop[];
}

export interface StageResult<O> {
  output: O;
  trace: StageTrace;
}

export type Stage<I, O> = (input: I, model: ModelPort) => Promise<StageResult<O>>;

export type MeetingContext = Pick<Meeting, "id" | "title" | "heldAt" | "timezone">;

export interface DecisionWithEvidence {
  decision: Decision;
  evidence: Evidence[];
}

export interface ExtractInput {
  meeting: MeetingContext;
  participants: Participant[];
  segments: Segment[];
}
export interface ExtractOutput {
  decisions: DecisionWithEvidence[];
}

export interface FindCandidatesInput {
  meeting: MeetingContext;
  segments: Segment[];
  decisions: DecisionWithEvidence[];
}
export interface FindCandidatesOutput {
  candidates: Candidate[];
}

export interface GenerateProbesInput {
  meeting: MeetingContext;
  participants: Participant[];
  decision: DecisionWithEvidence;
  candidate: Candidate;
  tier: ProbeTier;
}
export interface GenerateProbesOutput {
  probes: Probe[];
}

export interface CritiqueInput {
  candidate: Candidate;
  probe: Probe;
}
export interface CritiqueOutput {
  pass: boolean;
  reasons: string[];
}

export interface MapWriteInInput {
  probe: Probe;
  text: string;
}
/** `mappedOptionId: null` means unmapped: listed, never counted. */
export interface MapWriteInOutput {
  mappedOptionId: string | null;
  mappedByModel: true;
}

export interface DraftResolutionInput {
  decision: DecisionWithEvidence;
  probe: Probe;
  split: Split;
  answers: Answer[];
}
/** A proposal only: a participant must submit it before it becomes a Resolution. */
export interface DraftResolutionOutput {
  text: string;
  draftedByModel: true;
}

export interface GenerateRecheckInput {
  decision: DecisionWithEvidence;
  originalProbe: Probe;
  resolution: Resolution;
}
export interface GenerateRecheckOutput {
  probe: Probe;
}

export interface DraftRecordProseInput {
  record: DecisionRecord;
}
/** May only rephrase items already in the record; shown as a draft. */
export interface DraftRecordProseOutput {
  prose: string;
}

/** One participant's true readings. The simulator never sees anyone else's brief. */
export interface ParticipantBrief {
  participantId: string;
  readings: { decisionId: string; dimension: Dimension; reading: string }[];
}
export interface SimulateAnswerInput {
  brief: ParticipantBrief;
  /** Options already in this participant's shuffled order. */
  probe: Probe;
}
export interface SimulateAnswerOutput {
  answer: Pick<Answer, "choice" | "optionId">;
}

export interface Stages {
  extract: Stage<ExtractInput, ExtractOutput>;
  findCandidates: Stage<FindCandidatesInput, FindCandidatesOutput>;
  generateProbes: Stage<GenerateProbesInput, GenerateProbesOutput>;
  critique: Stage<CritiqueInput, CritiqueOutput>;
  mapWriteIn: Stage<MapWriteInInput, MapWriteInOutput>;
  draftResolution: Stage<DraftResolutionInput, DraftResolutionOutput>;
  generateRecheck: Stage<GenerateRecheckInput, GenerateRecheckOutput>;
  draftRecordProse: Stage<DraftRecordProseInput, DraftRecordProseOutput>;
  simulateAnswer: Stage<SimulateAnswerInput, SimulateAnswerOutput>;
}

// Compile-time check that Stages covers exactly the stage names.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const stagesCoverStageNames: Exact<keyof Stages, StageName> = true;
