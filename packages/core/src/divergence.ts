import type { Answer, Probe, Split } from "./model/probe";

export type DivergenceOutcome = Split["outcome"];

export type DivergenceAnswer = Pick<
  Answer,
  "participantId" | "choice" | "optionId" | "writeInText" | "mappedOptionId"
>;

export interface Divergence {
  outcome: DivergenceOutcome;
  /** Definite answers by option, in the probe's option order. Only chosen options appear. */
  groups: { optionId: string; participantIds: string[] }[];
  unsure: string[];
  /** Listed so the group sees them, never counted. */
  unmappedWriteIns: { participantId: string; text: string }[];
  nonResponders: string[];
  /** Definite answers out of active participants, e.g. "consistent, 3 of 4 answered". */
  coverage: { answered: number; of: number };
}

export class DivergenceError extends Error {}

/**
 * R§5.5. Definite answers are chosen options and write-ins with a model mapping.
 * - split: two or more distinct options among definite answers, whoever said "not sure";
 * - consistent: two or more definite answers, all the same, and nobody said "not sure";
 * - insufficient: anything else. "Not sure" is a reason to talk, never agreement.
 * Only answers from `participantIds` (the active participants) count, and their order
 * sets the order of every list, so the answers' order never matters.
 */
export function divergence(
  probe: Pick<Probe, "options">,
  participantIds: readonly string[],
  answers: readonly DivergenceAnswer[],
): Divergence {
  const optionIds = probe.options.map((o) => o.id);
  const byParticipant = new Map<string, DivergenceAnswer>();
  for (const a of answers) {
    if (byParticipant.has(a.participantId)) {
      throw new DivergenceError(`two answers from participant ${a.participantId}`);
    }
    byParticipant.set(a.participantId, a);
  }

  const chosen = new Map<string, string[]>();
  const unsure: string[] = [];
  const unmappedWriteIns: Divergence["unmappedWriteIns"] = [];
  const nonResponders: string[] = [];
  for (const pid of participantIds) {
    const a = byParticipant.get(pid);
    if (!a) {
      nonResponders.push(pid);
      continue;
    }
    const definite =
      a.choice === "option" ? a.optionId : a.choice === "write_in" ? a.mappedOptionId : null;
    if (a.choice === "unsure") {
      unsure.push(pid);
    } else if (definite !== null && optionIds.includes(definite)) {
      chosen.set(definite, [...(chosen.get(definite) ?? []), pid]);
    } else if (a.choice === "write_in") {
      unmappedWriteIns.push({ participantId: pid, text: a.writeInText ?? "" });
    } else {
      throw new DivergenceError(`participant ${pid} chose an option the probe does not have`);
    }
  }

  const groups = optionIds
    .filter((id) => chosen.has(id))
    .map((optionId) => ({ optionId, participantIds: chosen.get(optionId)! }));
  const answered = groups.reduce((n, g) => n + g.participantIds.length, 0);
  const outcome: DivergenceOutcome =
    groups.length >= 2
      ? "split"
      : answered >= 2 && unsure.length === 0
        ? "consistent"
        : "insufficient";

  return {
    outcome,
    groups,
    unsure,
    unmappedWriteIns,
    nonResponders,
    coverage: { answered, of: participantIds.length },
  };
}
