"use client";

import { useState } from "react";
import type { Probe, Split } from "@forkcheck/core";
import type { OrganizerMeetingState, StartRecheckResponse } from "../../contracts/api";
import { organizerCall } from "../api";
import { Button, ErrorNotice } from "../components";
import { currentProposal } from "../resolve";
import { isSettled, organizerRechecks, splitsToSettle } from "../stages";
import { RoundMonitor } from "./round";

type State = OrganizerMeetingState;

export const RECHECK_HINT =
  "The model writes one new question about what this wording means in practice. If everyone answers it the same way, the wording held.";
export const RECHECK_SENT =
  "Sent to everyone as a new question. Nobody sees the earlier answers while answering it.";
const NOTHING_TO_RECHECK =
  "A recheck starts once everyone has confirmed the wording for a difference.";

/**
 * Differences whose confirmed wording hasn't been rechecked. A recheck of the current wording
 * always moves the split on (passed, reopened, or settled as not conclusive), so confirmed and
 * unsettled means not rechecked yet.
 */
export function awaitingRecheck(state: State): Split[] {
  const rechecks = organizerRechecks(state);
  return splitsToSettle(state.splits, state.probes).filter(
    (s) => s.status === "confirmed" && !isSettled(s, rechecks),
  );
}

function StartRecheck({
  split,
  state,
  onChange,
}: {
  split: Split;
  state: State;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const call = organizerCall(state.meeting.id);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const hintId = `${split.id}-recheck-hint`;

  async function start() {
    setBusy(true);
    setFailure("");
    const res = await call<StartRecheckResponse>(
      `/api/splits/${encodeURIComponent(split.id)}/recheck`,
      { method: "POST" },
    );
    setBusy(false);
    if (!res.ok) setFailure(res.message);
    await onChange?.();
  }

  return (
    <>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <div className="publish">
        <Button disabled={busy} aria-describedby={hintId} onClick={() => void start()}>
          {busy ? "Writing the recheck question" : "Send a recheck question"}
        </Button>
        <span id={hintId} className="field-hint">
          {RECHECK_HINT}
        </span>
      </div>
    </>
  );
}

/**
 * Rechecking confirmed wording: send one new question per difference, then watch answers
 * come in and reveal them. Results show under each difference on the reveal.
 */
export function RecheckView({
  state,
  onChange,
}: {
  state: State;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const open = state.rounds.find((r) => r.kind === "recheck" && r.closedAt === null);
  const asked: Probe[] = state.probes.filter(
    (p) => p.kind === "recheck" && state.answerCounts.some((c) => c.probeId === p.id),
  );
  if (open || asked.length > 0) {
    return (
      <>
        <section aria-labelledby="recheck-heading">
          <h2 id="recheck-heading">Recheck question</h2>
          <p>{RECHECK_SENT}</p>
          {asked.map((p) => (
            <div key={p.id} className="recheck-question">
              <p className="fork-stem">{p.stem}</p>
              <ul>
                {p.options.map((o) => (
                  <li key={o.id}>{o.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <RoundMonitor state={state} onChange={onChange} />
      </>
    );
  }

  const waiting = awaitingRecheck(state);
  if (waiting.length === 0) return <p>{NOTHING_TO_RECHECK}</p>;
  const stemOf = new Map(state.probes.map((p) => [p.id, p.stem]));
  return (
    <section aria-labelledby="recheck-heading">
      <h2 id="recheck-heading">Ready for a recheck</h2>
      {waiting.map((split) => {
        const wording = currentProposal(state.resolutions.filter((r) => r.splitId === split.id));
        return (
          <article key={split.id} className="reveal-item">
            <h3>{stemOf.get(split.probeId)}</h3>
            {wording && (
              <figure className="quote proposal">
                <blockquote>
                  <p>{wording.text}</p>
                </blockquote>
                <figcaption>Confirmed by everyone asked</figcaption>
              </figure>
            )}
            <StartRecheck split={split} state={state} onChange={onChange} />
          </article>
        );
      })}
    </section>
  );
}
