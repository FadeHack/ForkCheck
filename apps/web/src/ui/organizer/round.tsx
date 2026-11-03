"use client";

import { useRef, useState } from "react";
import type { Participant } from "@forkcheck/core";
import type { CloseRoundResponse, OrganizerMeetingState } from "../../contracts/api";
import { organizerCall } from "../api";
import { Button, ErrorNotice, SpeakerChip } from "../components";
import { nameList } from "../labels";

type State = OrganizerMeetingState;

/** The server's rule: everyone has answered, or at least this many people have. */
export const QUORUM = 2;
export const QUORUM_NOTE =
  "You can reveal once everyone has answered, or earlier once at least 2 people have. Answers stay sealed until then, for you too.";

export interface PersonProgress {
  participant: Participant;
  /** Open questions this person has answered. */
  answered: number;
}

export interface RoundProgress {
  /** Open questions, as the server counts them. */
  total: number;
  people: PersonProgress[];
  /** Active participants who answered every open question. */
  done: number;
  active: number;
  /** Active participants who answered at least one. */
  responders: number;
  waitingFor: string[];
  canReveal: boolean;
}

/** Who has answered the open questions: counts and names only, never choices. */
export function roundProgress(state: Pick<State, "participants" | "answerCounts">): RoundProgress {
  const total = state.answerCounts.length;
  const people = state.participants.map((participant) => ({
    participant,
    answered: state.answerCounts.filter((c) => c.answeredBy.includes(participant.id)).length,
  }));
  const active = people.filter((p) => p.participant.status === "active");
  const done = active.filter((p) => p.answered === total).length;
  const responders = active.filter((p) => p.answered > 0).length;
  return {
    total,
    people,
    done,
    active: active.length,
    responders,
    waitingFor: active.filter((p) => p.answered < total).map((p) => p.participant.displayName),
    canReveal: total > 0 && (done === active.length || responders >= QUORUM),
  };
}

/** Why "Reveal answers" is disabled, or null when it isn't. */
export function revealBlockedReason(p: RoundProgress): string | null {
  if (p.canReveal) return null;
  if (p.responders === 0) return "Nobody has answered yet. At least 2 people need to answer first.";
  return "Only 1 person has answered. At least 2 people need to answer first.";
}

export function revealConfirmText(waitingFor: string[]): string {
  if (waitingFor.length === 1) {
    const [name] = waitingFor;
    return `${name} hasn't answered. Reveal now? ${name}'s questions will show as no response.`;
  }
  return `${nameList(waitingFor)} haven't answered. Reveal now? Their questions will show as no response.`;
}

export function personStatus({ participant, answered }: PersonProgress, total: number): string {
  if (participant.status === "absent") return "Absent, not asked";
  if (answered === total) return "Answered";
  if (answered === 0) return "Not answered yet";
  return `Answered ${answered} of ${total} questions`;
}

/**
 * The open round as the organizer sees it: who has answered, the quorum rule, "Mark absent",
 * and "Reveal answers", which asks first when someone hasn't answered.
 */
export function RoundMonitor({
  state,
  onChange,
}: {
  state: State;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const call = organizerCall(state.meeting.id);
  const round =
    state.rounds.find((r) => r.closedAt === null) ??
    // A closed round whose reveal stopped part way: revealing again resumes it.
    (state.meeting.error !== null && state.answerCounts.length > 0
      ? state.rounds.at(-1)
      : undefined);
  const progress = roundProgress(state);
  const blocked = revealBlockedReason(progress);
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  if (round === undefined) return <p>No questions are open right now.</p>;

  async function reveal() {
    dialog.current?.close();
    setBusy(true);
    setFailure("");
    const res = await call<CloseRoundResponse>(
      `/api/rounds/${encodeURIComponent(round!.id)}/close`,
      { method: "POST" },
    );
    setBusy(false);
    if (!res.ok) setFailure(res.message);
    await onChange?.();
  }

  async function setStatus(p: Participant, status: Participant["status"]) {
    setFailure("");
    const res = await call(
      `/api/meetings/${encodeURIComponent(state.meeting.id)}/participants/${encodeURIComponent(p.id)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    if (!res.ok) setFailure(res.message);
    await onChange?.();
  }

  const hintId = "reveal-hint";
  return (
    <>
      <section aria-labelledby="progress-heading">
        <h2 id="progress-heading">Answers so far</h2>
        <p role="status" className="round-focal">
          <span className="round-count">{progress.done}</span> of {progress.active} have answered.
        </p>
        <p>{QUORUM_NOTE}</p>
        {state.meeting.error !== null && round.closedAt !== null && (
          <ErrorNotice>{state.meeting.error}</ErrorNotice>
        )}
        {failure && <ErrorNotice>{failure}</ErrorNotice>}
        <div className="publish">
          <Button
            disabled={blocked !== null || busy}
            aria-describedby={blocked ? hintId : undefined}
            onClick={() =>
              progress.waitingFor.length === 0 || round.closedAt !== null
                ? void reveal()
                : dialog.current?.showModal()
            }
          >
            {busy ? "Revealing" : "Reveal answers"}
          </Button>
          {blocked && (
            <span id={hintId} className="field-hint">
              {blocked}
            </span>
          )}
        </div>
      </section>
      <section aria-labelledby="people-heading">
        <h2 id="people-heading">Participants</h2>
        <ul className="people-list">
          {progress.people.map((person) => {
            const { participant: p } = person;
            const absent = p.status === "absent";
            return (
              <li key={p.id}>
                <SpeakerChip name={p.displayName} simulated={p.isSimulated} />
                <span className="person-status">{personStatus(person, progress.total)}</span>
                {round.closedAt === null && (
                  <Button
                    variant="secondary"
                    aria-label={`${absent ? "Mark present" : "Mark absent"}: ${p.displayName}`}
                    onClick={() => void setStatus(p, absent ? "active" : "absent")}
                  >
                    {absent ? "Mark present" : "Mark absent"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <dialog ref={dialog} className="dialog" aria-labelledby="reveal-confirm">
        <p id="reveal-confirm">{revealConfirmText(progress.waitingFor)}</p>
        <div className="actions">
          <Button onClick={() => void reveal()}>Reveal now</Button>
          <Button variant="secondary" onClick={() => dialog.current?.close()}>
            Keep waiting
          </Button>
        </div>
      </dialog>
    </>
  );
}
