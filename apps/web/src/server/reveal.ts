import { divergence, type Meeting, type Round, type Split } from "@forkcheck/core";
import { mapWriteIn } from "@forkcheck/engine";
import type { CloseRoundResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { apiError, json } from "./http";
import { logError } from "./log";
import { revealedSplits } from "./rounds";

export const REVEAL_FAILED =
  "Revealing stopped while matching written answers to options. Reveal again to finish.";

const running = () =>
  apiError(409, "reveal_running", "Answers are being revealed already. Reload in a moment.");

/** The round's sent questions, the active participants and their answers, as stored now. */
async function roundAnswers(deps: Deps, round: Round) {
  const probes = (await deps.rounds.probes(round.id)).filter((p) => p.status === "published");
  const active = (await deps.meetings.participants(round.meetingId))
    .filter((p) => p.status === "active")
    .map((p) => p.id);
  const answers = await deps.rounds.answers(probes.map((p) => p.id));
  return { probes, active, answers };
}

/** True once the round's splits are saved: answers are revealed and the round is finished. */
async function revealDone(deps: Deps, meeting: Meeting, round: Round): Promise<boolean> {
  if (round.kind === "diagnostic") return meeting.status !== "probing";
  const probes = await deps.rounds.probes(round.id);
  const splits = await deps.splits.list(meeting.id);
  return probes.every((p) => splits.some((s) => s.probeId === p.id));
}

/**
 * Closes a round when every active participant has answered every question, or on the
 * organizer's say with at least 2 people answering. Then write-ins are matched by the model,
 * divergence is computed in code, and splits are saved. A recheck round's outcome is applied
 * to the split it rechecked. A closed round that already has its reveal returns it again;
 * one whose matching failed resumes.
 */
export async function closeRound(deps: Deps, meeting: Meeting, round: Round): Promise<Response> {
  if (round.closedAt === null) {
    if (round.kind === "diagnostic" && meeting.status !== "probing") {
      return apiError(409, "not_probing", "This meeting has no round waiting to be revealed.");
    }
    const { probes, active, answers } = await roundAnswers(deps, round);
    const allAnswered = active.every((pid) =>
      probes.every((p) => answers.some((a) => a.probeId === p.id && a.participantId === pid)),
    );
    const responders = new Set(
      answers.filter((a) => active.includes(a.participantId)).map((a) => a.participantId),
    );
    if (!allAnswered && responders.size < 2) {
      return apiError(
        409,
        "no_quorum",
        "At least 2 people need to answer before the answers can be revealed.",
      );
    }
    const reason = allAnswered ? "all_answered" : "organizer_quorum";
    if (!(await deps.rounds.closeIfOpen(round.id, deps.now().toISOString(), reason))) {
      return running();
    }
  } else if (await revealDone(deps, meeting, round)) {
    return json(await response(deps, round.id));
  } else if (
    meeting.error !== REVEAL_FAILED ||
    !(await deps.meetings.claimError(meeting.id, REVEAL_FAILED))
  ) {
    return running();
  }

  // Read again after the close: an answer may have landed just before it.
  const { probes, active, answers } = await roundAnswers(deps, round);
  const model = deps.model(meeting.id);
  try {
    for (const a of answers) {
      if (a.choice !== "write_in" || a.mappedOptionId !== null) continue;
      const probe = probes.find((p) => p.id === a.probeId)!;
      const { output } = await mapWriteIn({ probe, text: a.writeInText ?? "" }, model);
      await deps.rounds.mapWriteIn(a.id, output.mappedOptionId);
      a.mappedOptionId = output.mappedOptionId;
    }
  } catch (error) {
    logError(`reveal ${round.id}`, error);
    await deps.meetings.setStatus(meeting.id, meeting.status, REVEAL_FAILED);
    return apiError(502, "reveal_failed", REVEAL_FAILED);
  }

  const splits: Split[] = probes.map((p) => ({
    id: `${p.id}:split`,
    probeId: p.id,
    outcome: divergence(
      p,
      active,
      answers.filter((a) => a.probeId === p.id),
    ).outcome,
    validity: [],
    status: "open",
  }));
  if (round.kind === "diagnostic") {
    await deps.splits.saveReveal(meeting.id, splits);
  } else {
    for (const split of splits) {
      const original = probes.find((p) => p.id === split.probeId)!.splitId!;
      const result = await deps.splits.saveRecheck(split, original);
      if (!result?.ok) throw new Error(`recheck ${split.id} could not be applied to ${original}`);
    }
  }
  return json(await response(deps, round.id));
}

async function response(deps: Deps, roundId: string): Promise<CloseRoundResponse> {
  const round = (await deps.rounds.get(roundId))!;
  return { round, splits: await revealedSplits(deps, round.meetingId, roundId) };
}
