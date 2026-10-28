import {
  selectProbes,
  tierFor,
  TIERS,
  type Candidate,
  type Participant,
  type Probe,
  type Segment,
  type TierConfig,
} from "@forkcheck/core";
import type {
  DecisionWithEvidence,
  Drop,
  MeetingContext,
  ModelPort,
  StageTrace,
} from "./contracts";
import { vetProbe } from "./vet-probe";

export interface DraftProbesInput {
  meeting: MeetingContext;
  participants: Participant[];
  segments: Segment[];
  decisions: DecisionWithEvidence[];
  candidates: Candidate[];
  tiers?: TierConfig;
}

export interface DraftProbesOutput {
  /** Vetted probes, at most one per decision and dimension, in selection order (impact first). */
  probes: Probe[];
  traces: StageTrace[];
  drops: Drop[];
}

/**
 * Vets one probe per candidate at its configured tier, then ranks them with the selection
 * rules and no budget, so the organizer sees every usable draft and the default picks first.
 */
export async function draftProbes(
  input: DraftProbesInput,
  model: ModelPort,
): Promise<DraftProbesOutput> {
  const byId = new Map(input.decisions.map((d) => [d.decision.id, d]));
  const traces: StageTrace[] = [];
  const drops: Drop[] = [];
  const vetted = [];
  for (const candidate of input.candidates) {
    const decision = byId.get(candidate.decisionId);
    if (!decision) {
      drops.push({ reason: "unknown_decision", item: candidate });
      continue;
    }
    const result = await vetProbe(
      {
        meeting: input.meeting,
        participants: input.participants,
        decision,
        candidate,
        tier: tierFor(candidate.dimension, input.tiers ?? TIERS),
        segments: input.segments,
      },
      model,
    );
    traces.push(...result.traces);
    drops.push(...result.drops);
    if (result.probe) {
      vetted.push({ probe: result.probe, candidate, decisionIdx: decision.decision.idx });
    }
  }
  const ranked = selectProbes(vetted, { budget: Number.POSITIVE_INFINITY });
  return { probes: ranked.map((v) => v.probe), traces, drops };
}
