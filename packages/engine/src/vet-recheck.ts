import { lintRecheck, type Probe, type Segment } from "@forkcheck/core";
import type { Drop, GenerateRecheckInput, ModelPort, StageTrace } from "./contracts";
import { generateRecheckWith } from "./stages/generate-recheck";
import type { ProbeFeedback } from "./stages/generate-probes";
import { MAX_GENERATIONS } from "./vet-probe";

export interface VetRecheckInput extends GenerateRecheckInput {
  /** Transcript turns, for the verbatim-speaker lint rule. */
  segments: Segment[];
}

export interface VetRecheckResult {
  /** A recheck with no lint findings, or null if both generations failed lint. */
  probe: Probe | null;
  consequence: string | null;
  traces: StageTrace[];
  drops: Drop[];
}

/**
 * Generate and lint one recheck. A recheck that fails lint, novelty included, is rewritten
 * once with its findings as feedback; if the rewrite fails too, it is dropped.
 */
export async function vetRecheck(
  input: VetRecheckInput,
  model: ModelPort,
): Promise<VetRecheckResult> {
  const { segments, ...generateInput } = input;
  const original = { stem: input.originalProbe.stem, resolutionText: input.resolution.text };
  const traces: StageTrace[] = [];
  const drops: Drop[] = [];
  let feedback: ProbeFeedback | undefined;

  for (let generation = 1; generation <= MAX_GENERATIONS; generation++) {
    const generated = await generateRecheckWith(generateInput, model, feedback);
    traces.push(generated.trace);
    const { probe, consequence } = generated.output;
    const findings = lintRecheck(probe, { original, segments });
    const problems = findings.map((f) => f.detail);
    if (probe.stem === "") problems.push("the question is empty");
    if (problems.length === 0) return { probe, consequence, traces, drops };

    if (generation === MAX_GENERATIONS) {
      drops.push({ reason: "failed_twice_lint", item: { probe, findings, problems } });
    } else {
      drops.push({ reason: "regenerated_after_lint", item: { probe, findings, problems } });
      feedback = { probe, problems };
    }
  }
  return { probe: null, consequence: null, traces, drops };
}
