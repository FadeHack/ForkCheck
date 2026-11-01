import { randomUUID } from "node:crypto";
import {
  lintProbe,
  optionOrder,
  PROBE_BUDGET,
  probeQuote,
  type Answer,
  type LintFinding,
  type Meeting,
  type Participant,
  type Probe,
  type QuoteSources,
  type Round,
} from "@forkcheck/core";
import { meetingReplays } from "@forkcheck/db";
import type {
  EditProbeRequest,
  OpenRoundRequest,
  OpenRoundResponse,
  ParticipantProbe,
  ParticipantState,
  RevealedSplit,
  SubmitAnswerRequest,
} from "../contracts/api";
import type { Deps } from "./deps";
import { apiError, invalidBody, json, notFound } from "./http";

/** Publishes up to PROBE_BUDGET linted drafts as the meeting's next round. */
export async function openRound(
  deps: Deps,
  meeting: Meeting,
  body: OpenRoundRequest,
): Promise<Response> {
  if (meeting.status !== "probing") {
    return apiError(
      409,
      "not_probing",
      "Questions can be sent after analysis and before answers are revealed.",
    );
  }
  const ids = body.probeIds;
  if (new Set(ids).size !== ids.length) {
    return invalidBody({ probeIds: ["List each question once."] });
  }
  if (ids.length > PROBE_BUDGET) {
    return invalidBody({ probeIds: [`Send at most ${PROBE_BUDGET} questions in a round.`] });
  }
  const probes = new Map((await deps.meetings.probes(meeting.id)).map((p) => [p.probe.id, p]));
  const unknown = ids.filter((id) => !probes.has(id));
  if (unknown.length > 0) {
    return invalidBody({ probeIds: [`Not a question in this meeting: ${unknown.join(", ")}`] });
  }
  const chosen = ids.map((id) => probes.get(id)!.probe);
  if (chosen.some((p) => p.status !== "draft")) {
    return apiError(
      409,
      "not_draft",
      "Only draft questions can be sent. Withdrawn or already sent questions can't go in a new round.",
    );
  }
  const failing = chosen.filter((p) => p.lint.length > 0);
  if (failing.length > 0) {
    return apiError(
      409,
      "lint_failed",
      `Edit or withdraw the questions that fail checks: ${failing.map((p) => `"${p.stem}"`).join(", ")}.`,
    );
  }
  const round: Round = {
    id: `${meeting.id}:round:${(await deps.rounds.list(meeting.id)).length}`,
    meetingId: meeting.id,
    kind: "diagnostic",
    openedAt: deps.now().toISOString(),
    closedAt: null,
    closeReason: null,
  };
  if (!(await deps.rounds.open(round, ids))) {
    return apiError(409, "round_open", "A round is already open. Close it before sending more.");
  }
  const response: OpenRoundResponse = { roundId: round.id };
  return json(response, 201);
}

/** Lint for an edited draft, with the same decision target and transcript as drafting used. */
async function relint(deps: Deps, probe: Probe): Promise<LintFinding[]> {
  const [analysis, segments] = await Promise.all([
    deps.meetings.analysis(probe.meetingId),
    deps.meetings.segments(probe.meetingId),
  ]);
  const candidate = analysis.candidates.find((c) => c.id === probe.candidateId);
  const decision = analysis.decisions.find((d) => d.decision.id === candidate?.decisionId);
  const targets =
    candidate && decision ? [{ decision: decision.decision, dimension: candidate.dimension }] : [];
  return lintProbe(probe, { targets, segments });
}

/**
 * Edits a question that was never sent, or withdraws one. A question in an open round can be
 * withdrawn but not edited, since some participants may already have answered it.
 */
export async function editProbe(
  deps: Deps,
  meeting: Meeting,
  probeId: string,
  body: EditProbeRequest,
): Promise<Response> {
  const found = await deps.rounds.getProbe(probeId);
  if (found === null) return notFound("Question");
  const { probe, roundId } = found;
  const editing = body.stem !== undefined || body.options !== undefined;
  if (editing && roundId !== null) {
    return apiError(
      409,
      "probe_sent",
      "This question was already sent, so it can't be edited. Withdraw it instead.",
    );
  }

  let status = probe.status;
  if (body.withdrawn === true && status === "published") {
    const open = await deps.rounds.openRound(meeting.id);
    if (open === null || open.id !== roundId) {
      return apiError(
        409,
        "round_closed",
        "This question's round has closed, so it can't be withdrawn.",
      );
    }
  }
  if (body.withdrawn === true) status = "withdrawn";
  if (body.withdrawn === false && status === "withdrawn") {
    if (roundId !== null) {
      return apiError(
        409,
        "probe_sent",
        "This question was withdrawn after it was sent, so it can't be restored.",
      );
    }
    status = "draft";
  }

  const next: Probe = { ...probe, status };
  if (body.stem !== undefined) next.stem = body.stem;
  if (body.options !== undefined) {
    next.options = body.options.map((text, k) => ({ id: `${probe.id}:opt:${k}`, text }));
  }
  if (editing) next.lint = await relint(deps, next);
  await deps.rounds.updateProbe(next);
  return json(next);
}

const toParticipantProbe = (p: Probe): ParticipantProbe => ({
  id: p.id,
  kind: p.kind,
  splitId: p.splitId,
  stem: p.stem,
  options: p.options,
});

/**
 * Revealed splits, in question rank order, with every answer: the same for every viewer.
 * Options keep their stored order here so everyone compares the same list.
 */
export async function revealedSplits(
  deps: Deps,
  meetingId: string,
  roundId?: string,
): Promise<RevealedSplit[]> {
  const splits = await deps.splits.list(meetingId);
  if (splits.length === 0) return [];
  const [probes, analysis, segments] = await Promise.all([
    deps.meetings.probes(meetingId),
    deps.meetings.analysis(meetingId),
    deps.meetings.segments(meetingId),
  ]);
  const sources: QuoteSources = {
    probes: probes.map((p) => p.probe),
    splits,
    candidates: analysis.candidates,
    decisions: analysis.decisions,
    segments,
  };
  const byProbe = new Map(splits.map((s) => [s.probeId, s]));
  const shown = probes
    .filter((p) => byProbe.has(p.probe.id) && (roundId === undefined || p.roundId === roundId))
    .map((p) => ({ probe: p.probe, split: byProbe.get(p.probe.id)! }));
  const [answers, resolutions] = await Promise.all([
    deps.rounds.answers(shown.map((s) => s.probe.id)),
    deps.splits.resolutions(shown.map((s) => s.split.id)),
  ]);
  const confirmations = await deps.splits.confirmations(resolutions.map((r) => r.id));
  return shown.map(({ probe, split }) => {
    const own = resolutions.filter((r) => r.splitId === split.id);
    return {
      split,
      probe: toParticipantProbe(probe),
      quote: probeQuote(probe.id, sources),
      answers: answers.filter((a) => a.probeId === probe.id),
      resolutions: own,
      confirmations: confirmations.filter((c) => own.some((r) => r.id === c.resolutionId)),
    };
  });
}

/** Who else still owes an answer on the open questions, by name only. */
async function waitingOn(
  deps: Deps,
  viewer: Participant,
  participants: Participant[],
  open: Probe[],
): Promise<string[]> {
  if (open.length === 0) return [];
  const answers = await deps.rounds.answers(open.map((p) => p.id));
  const answered = new Map<string, number>();
  for (const a of answers) answered.set(a.participantId, (answered.get(a.participantId) ?? 0) + 1);
  return participants
    .filter((p) => p.id !== viewer.id && p.status === "active")
    .filter((p) => (answered.get(p.id) ?? 0) < open.length)
    .map((p) => p.displayName);
}

/** Open questions in this participant's option order, their own answers, and closed rounds. */
export async function participantState(
  deps: Deps,
  participant: Participant,
  meeting: Meeting,
): Promise<ParticipantState> {
  const open = await deps.rounds.openRound(meeting.id);
  const probes = (open === null ? [] : await deps.rounds.probes(open.id)).filter(
    (p) => p.status === "published",
  );
  const participants = await deps.meetings.participants(meeting.id);
  return {
    participant,
    participants,
    meeting: { id: meeting.id, title: meeting.title, status: meeting.status },
    openProbes: probes.map((p) => toParticipantProbe(optionOrder(p, participant.id))),
    ownAnswers: await deps.rounds.answersBy(participant.id),
    waitingOn: await waitingOn(deps, participant, participants, probes),
    revealed: await revealedSplits(deps, meeting.id),
    replayed: await meetingReplays(deps.db, meeting.id),
  };
}

/** Saves or replaces this participant's answer while the question's round is open. */
export async function submitAnswer(
  deps: Deps,
  participant: Participant,
  body: SubmitAnswerRequest,
): Promise<Response> {
  const found = await deps.rounds.getProbe(body.probeId);
  // Drafts are invisible to participants, so they get the same 404 as unknown IDs.
  if (found === null || found.probe.meetingId !== participant.meetingId || found.roundId === null) {
    return notFound("Question");
  }
  const { probe, roundId } = found;
  if (probe.status === "withdrawn") {
    return apiError(
      409,
      "probe_withdrawn",
      "The organizer withdrew this question, so it no longer takes answers.",
    );
  }
  if (body.optionId !== undefined && !probe.options.some((o) => o.id === body.optionId)) {
    return invalidBody({ optionId: ["Pick one of this question's options."] });
  }
  const answer: Answer = {
    id: randomUUID(),
    probeId: probe.id,
    participantId: participant.id,
    choice: body.choice,
    optionId: body.optionId ?? null,
    writeInText: body.writeIn ?? null,
    mappedOptionId: null,
    mappedByModel: false,
    // Whoever types on a simulated participant's link, the answer is not a real person's.
    simulated: participant.isSimulated,
  };
  const saved = await deps.rounds.putAnswerIfOpen(roundId, answer);
  return saved === null
    ? apiError(409, "round_closed", "This round has closed, so answers can't change now.")
    : json(saved);
}
