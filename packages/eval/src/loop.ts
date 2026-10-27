import {
  applyResolutionEvent,
  buildRecord,
  currentResolution,
  divergence,
  initialResolutionState,
  optionOrder,
  selectProbes,
  validateRecord,
  type Candidate,
  type DecisionRecord,
  type Divergence,
  type DivergenceAnswer,
  type DivergenceOutcome,
  type Probe,
  type RecordInput,
  type RecordValidation,
  type ResolutionEvent,
  type ResolutionState,
  type Segment,
} from "@forkcheck/core";
import {
  draftRecordProse,
  extract,
  findCandidates,
  simulateAnswer,
  vetProbe,
  vetRecheck,
  type Drop,
  type ModelPort,
  type ParticipantBrief,
  type StageTrace,
} from "@forkcheck/engine";
import { matchDecisions, scenarioExtractInput } from "./extract-score";
import type { Scenario } from "./scenario";
import { recheckBriefs, scenarioBriefs } from "./simulate";

export type ResolutionVariant = "precise" | "vague";

export interface LoopOptions {
  resolution: ResolutionVariant;
}

export interface LoopRound {
  probeId: string;
  stem: string;
  options: Probe["options"];
  answers: Pick<DivergenceAnswer, "participantId" | "choice" | "optionId">[];
  divergence: Divergence;
}

export interface LoopSplit {
  splitId: string;
  probeId: string;
  /** The planted mismatch this split landed on, or null for a split the scenario did not plant. */
  mismatch: string | null;
  /** How the split was matched to the mismatch: same decision and dimension, or decision only. */
  matchedOn: "dimension" | "decision" | null;
  events: ResolutionEvent[];
  recheck: {
    probe: Probe | null;
    consequence: string | null;
    drops: Drop[];
    round: LoopRound | null;
  } | null;
  state: ResolutionState;
}

export interface LoopTrace {
  scenario: string;
  resolution: ResolutionVariant;
  /** Every stage call in order, with its model calls and drops. */
  stages: StageTrace[];
  candidates: {
    id: string;
    decisionId: string;
    dimension: Candidate["dimension"];
    mismatch: string | null;
    probeId: string | null;
    drops: Drop[];
  }[];
  selected: string[];
  rounds: LoopRound[];
  splits: LoopSplit[];
  validation: RecordValidation;
  costUsd: number;
}

export interface LoopResult {
  record: DecisionRecord;
  /** What the record was built from, for re-validating. */
  recordInput: RecordInput;
  /** Transcript turns with speakers, for rendering stated quotes. */
  segments: Segment[];
  trace: LoopTrace;
}

function apply(state: ResolutionState, event: ResolutionEvent): ResolutionState {
  const result = applyResolutionEvent(state, event);
  if (!result.ok) throw new Error(`scripted ${event.type} failed: ${result.error.message}`);
  return result.state;
}

/**
 * The whole loop in memory: extract, candidates, vetted probes, selection, simulated private
 * answers, divergence, the scenario's scripted resolution on each planted split, recheck,
 * then a validated record with a draft summary. Each planted mismatch resolves one split on
 * its decision, preferring the same dimension, since the model may file the gap under a
 * neighbouring dimension. Splits the scenario did not plant stay open.
 * The run's clock is the meeting's time, so a replay builds the same record.
 */
export async function runLoop(
  s: Scenario,
  model: ModelPort,
  { resolution }: LoopOptions,
): Promise<LoopResult> {
  const stages: StageTrace[] = [];
  const input = scenarioExtractInput(s);
  const participantIds = input.participants.map((p) => p.id);
  const at = s.heldAt;

  const extracted = await extract(input, model);
  stages.push(extracted.trace);
  const { decisions } = extracted.output;
  const found = await findCandidates({ ...input, decisions }, model);
  stages.push(found.trace);

  const matches = matchDecisions(s, decisions);
  const onDecision = (m: Scenario["plantedMismatches"][number], c: Candidate) => {
    const i = matches.get(m.decision);
    return i !== undefined && decisions[i]!.decision.id === c.decisionId;
  };
  const mismatchOf = (c: Candidate) =>
    s.plantedMismatches.find((m) => onDecision(m, c) && m.dimension === c.dimension) ?? null;
  const byId = new Map(decisions.map((d) => [d.decision.id, d]));

  const vetted = [];
  for (const candidate of found.output.candidates) {
    const decision = byId.get(candidate.decisionId)!;
    const result = await vetProbe(
      {
        meeting: input.meeting,
        participants: input.participants,
        decision,
        candidate,
        tier: "free",
        segments: input.segments,
      },
      model,
    );
    stages.push(...result.traces);
    vetted.push({ candidate, decision, ...result });
  }
  const selected = selectProbes(
    vetted.flatMap((v) =>
      v.probe
        ? [{ probe: v.probe, candidate: v.candidate, decisionIdx: v.decision.decision.idx }]
        : [],
    ),
  );

  async function ask(probe: Probe, briefs: ParticipantBrief[]): Promise<LoopRound> {
    const answers: DivergenceAnswer[] = [];
    for (const brief of briefs) {
      const shown = optionOrder(probe, brief.participantId);
      const { output, trace } = await simulateAnswer({ brief, probe: shown }, model);
      stages.push(trace);
      answers.push({
        participantId: brief.participantId,
        ...output.answer,
        writeInText: null,
        mappedOptionId: null,
      });
    }
    return {
      probeId: probe.id,
      stem: probe.stem,
      options: probe.options,
      answers: answers.map(({ participantId, choice, optionId }) => ({
        participantId,
        choice,
        optionId,
      })),
      divergence: divergence(probe, participantIds, answers),
    };
  }

  const briefs = scenarioBriefs(s);
  const rounds: LoopRound[] = [];
  const splitting: { probe: Probe; candidate: Candidate; splitId: string }[] = [];
  for (const { probe: draft, candidate } of selected) {
    const probe: Probe = { ...draft, status: "published" };
    const round = await ask(probe, briefs);
    rounds.push(round);
    if (round.divergence.outcome === "split") {
      splitting.push({ probe, candidate, splitId: `${probe.id}:split` });
    }
  }

  const planted = new Map<string, { id: string; matchedOn: "dimension" | "decision" }>();
  for (const m of s.plantedMismatches) {
    const free = splitting.filter((x) => onDecision(m, x.candidate) && !planted.has(x.splitId));
    const same = free.find((x) => x.candidate.dimension === m.dimension);
    const pick = same ?? free[0];
    if (pick) planted.set(pick.splitId, { id: m.id, matchedOn: same ? "dimension" : "decision" });
  }

  const splits: (LoopSplit & { candidate: Candidate })[] = [];
  for (const { probe, candidate, splitId } of splitting) {
    const match = planted.get(splitId) ?? null;
    const scripted = s.scriptedResolutions.find((r) => r.mismatch === match?.id);
    const proposer = { kind: "participant" as const, participantId: participantIds[0]! };
    const events: ResolutionEvent[] = [];
    let state = initialResolutionState(splitId, input.participants);
    const play = (e: ResolutionEvent) => {
      events.push(e);
      state = apply(state, e);
    };
    let recheck: LoopSplit["recheck"] = null;

    if (scripted?.endsIn === "agree_to_disagree") {
      play({ type: "agree_to_disagree", actor: proposer });
    } else if (scripted) {
      const text = scripted[resolution].text;
      play({
        type: "propose",
        actor: proposer,
        resolutionId: `${splitId}:res:0`,
        text,
        draftedByModel: false,
      });
      for (const participantId of participantIds) {
        play({ type: "confirm", actor: { kind: "participant", participantId }, at });
      }
      const result = await vetRecheck(
        {
          decision: byId.get(candidate.decisionId)!,
          originalProbe: probe,
          resolution: currentResolution(state)!,
          segments: input.segments,
        },
        model,
      );
      stages.push(...result.traces);
      recheck = {
        probe: result.probe,
        consequence: result.consequence,
        drops: result.drops,
        round: null,
      };
      if (result.probe) {
        const recheckProbe: Probe = { ...result.probe, status: "published" };
        recheck.round = await ask(recheckProbe, recheckBriefs(s, scripted.mismatch, text));
        const outcome: DivergenceOutcome = recheck.round.divergence.outcome;
        play({ type: "recheck", outcome });
      }
    }
    splits.push({
      splitId,
      probeId: probe.id,
      mismatch: match?.id ?? null,
      matchedOn: match?.matchedOn ?? null,
      events,
      recheck,
      state,
      candidate,
    });
  }

  const recordInput: RecordInput = {
    meeting: input.meeting,
    generatedAt: at,
    participants: input.participants,
    segments: input.segments,
    decisions,
    splits: splits.map((x) => ({
      decisionId: x.candidate.decisionId,
      dimension: x.candidate.dimension,
      state: x.state,
      deadline: null,
    })),
  };
  const built = buildRecord(recordInput);
  const validation = validateRecord(built, recordInput);
  const prose = await draftRecordProse({ record: built }, model);
  stages.push(prose.trace);
  const record: DecisionRecord = { ...built, proseDraft: prose.output.prose || null };

  return {
    record,
    recordInput,
    segments: input.segments,
    trace: {
      scenario: s.id,
      resolution,
      stages,
      candidates: vetted.map((v) => ({
        id: v.candidate.id,
        decisionId: v.candidate.decisionId,
        dimension: v.candidate.dimension,
        mismatch: mismatchOf(v.candidate)?.id ?? null,
        probeId: v.probe?.id ?? null,
        drops: v.drops,
      })),
      selected: selected.map((x) => x.probe.id),
      rounds,
      splits: splits.map(({ candidate: _, ...rest }) => rest),
      validation,
      costUsd: stages.reduce((t, st) => t + st.calls.reduce((u, c) => u + c.costUsd, 0), 0),
    },
  };
}
