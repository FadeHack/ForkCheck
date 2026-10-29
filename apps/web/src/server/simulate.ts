import { randomUUID } from "node:crypto";
import { currentResolution, optionOrder, type Meeting, type Probe } from "@forkcheck/core";
import { confirmedResolutionNote, simulateAnswer } from "@forkcheck/engine";
import type { SimulateAnswersResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { apiError, json } from "./http";
import { logError } from "./log";

/** A recheck question is answered knowing the resolution the group confirmed. */
async function notesFor(deps: Deps, probe: Probe, notes: string): Promise<string> {
  if (probe.kind !== "recheck" || probe.splitId === null) return notes;
  const state = await deps.splits.state(probe.splitId);
  const resolution = state && currentResolution(state);
  return resolution ? `${notes}\n${confirmedResolutionNote(resolution.text)}` : notes;
}

/**
 * Answers the open round for every active simulated participant, from the notes the organizer
 * gave them, in their own option order. Questions they have already answered are skipped, so
 * a call that stopped partway can be repeated. Answers stay sealed: only a count is returned.
 */
export async function answerForSimulated(deps: Deps, meeting: Meeting): Promise<Response> {
  const round = await deps.rounds.openRound(meeting.id);
  if (round === null) {
    return apiError(409, "no_open_round", "No round is open, so there is nothing to answer.");
  }
  const simulated = (await deps.meetings.participants(meeting.id)).filter(
    (p) => p.isSimulated && p.status === "active",
  );
  if (simulated.length === 0) {
    return apiError(409, "no_simulated", "This meeting has no simulated participants present.");
  }
  const notes = await deps.meetings.simulatorNotes(meeting.id);
  const probes = (await deps.rounds.probes(round.id)).filter((p) => p.status === "published");
  const answered = await deps.rounds.answers(probes.map((p) => p.id));
  const model = deps.model(meeting.id);

  let submitted = 0;
  for (const participant of simulated) {
    for (const probe of probes) {
      if (answered.some((a) => a.probeId === probe.id && a.participantId === participant.id)) {
        continue;
      }
      let answer;
      try {
        const brief = {
          participantId: participant.id,
          readings: [],
          notes: await notesFor(deps, probe, notes.get(participant.id) ?? ""),
        };
        const shown = optionOrder(probe, participant.id);
        answer = (await simulateAnswer({ brief, probe: shown }, model)).output.answer;
      } catch (error) {
        logError(`simulate ${round.id}`, error);
        return apiError(
          502,
          "simulate_failed",
          "Simulated answers stopped partway. Run it again to answer the rest.",
        );
      }
      const saved = await deps.rounds.putAnswerIfOpen(round.id, {
        id: randomUUID(),
        probeId: probe.id,
        participantId: participant.id,
        ...answer,
        writeInText: null,
        mappedOptionId: null,
        mappedByModel: false,
        simulated: true,
      });
      if (saved === null) {
        return apiError(409, "round_closed", "This round has closed, so answers can't change now.");
      }
      submitted += 1;
    }
  }
  const response: SimulateAnswersResponse = { submitted };
  return json(response);
}
