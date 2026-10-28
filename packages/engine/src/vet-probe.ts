import { lintProbe, templateProbe, type Probe, type Segment } from "@forkcheck/core";
import type { Drop, GenerateProbesInput, ModelPort, StageTrace } from "./contracts";
import { critique } from "./stages/critique";
import { generateProbesWith, type ProbeFeedback } from "./stages/generate-probes";

export interface VetProbeInput extends GenerateProbesInput {
  /** Transcript turns, for the verbatim-speaker lint rule. */
  segments: Segment[];
}

export interface VetProbeResult {
  /** A probe with no lint findings that the critic passed, or null if it was dropped. */
  probe: Probe | null;
  traces: StageTrace[];
  drops: Drop[];
}

/** Generations per candidate: the first try and one rewrite with feedback. */
export const MAX_GENERATIONS = 2;

/**
 * Generate, lint, then critique one candidate's probe. A failing probe is rewritten once
 * with its problems as feedback; if the rewrite fails too, it is dropped with the reason.
 * Lint runs first so the critic is never paid for a probe the code already rejects.
 */
export async function vetProbe(input: VetProbeInput, model: ModelPort): Promise<VetProbeResult> {
  if (input.tier === "template") return vetTemplate(input);
  const { segments, ...generateInput } = input;
  const targets = [{ decision: input.decision.decision, dimension: input.candidate.dimension }];
  const traces: StageTrace[] = [];
  const drops: Drop[] = [];
  let feedback: ProbeFeedback | undefined;

  for (let generation = 1; generation <= MAX_GENERATIONS; generation++) {
    const generated = await generateProbesWith(generateInput, model, feedback);
    traces.push(generated.trace);
    const [probe, ...extra] = generated.output.probes;
    for (const p of extra) drops.push({ reason: "extra_probe", item: p });
    if (!probe) {
      // The prompt allows an empty answer when no fair question exists; asking again
      // would only push the model to force one.
      drops.push({ reason: "model_declined", item: input.candidate });
      break;
    }

    const findings = lintProbe(probe, { targets, segments });
    let problems = findings.map((f) => f.detail);
    let failure = "lint";
    if (findings.length === 0) {
      const judged = await critique({ candidate: input.candidate, probe }, model);
      traces.push(judged.trace);
      if (judged.output.pass) return { probe, traces, drops };
      problems = judged.output.reasons;
      failure = "critic";
    }

    if (generation === MAX_GENERATIONS) {
      drops.push({ reason: `failed_twice_${failure}`, item: { probe, findings, problems } });
    } else {
      drops.push({ reason: `regenerated_after_${failure}`, item: { probe, findings, problems } });
      feedback = { probe, problems };
    }
  }
  return { probe: null, traces, drops };
}

/**
 * T0: the template is fixed text from code, so there is nothing for the critic to judge and
 * nothing to rewrite; a template that fails lint is dropped.
 */
function vetTemplate(input: VetProbeInput): VetProbeResult {
  const probe = templateProbe({ ...input, decision: input.decision.decision });
  if (!probe)
    return { probe: null, traces: [], drops: [{ reason: "no_template", item: input.candidate }] };
  if (probe.lint.length > 0) {
    return {
      probe: null,
      traces: [],
      drops: [{ reason: "template_failed_lint", item: { probe, findings: probe.lint } }],
    };
  }
  return { probe, traces: [], drops: [] };
}
