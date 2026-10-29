"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ParticipantState } from "../../contracts/api";
import { callApi, type Loaded } from "../api";
import { Button, ErrorNotice, ForkView, Loading, StatusLabel } from "../components";
import { waitingLine } from "../labels";
import { participantStage } from "../stages";
import { AnswerForm, answerText } from "./answers";

export const ANSWER_INTRO =
  "Answer on your own. Nobody sees your answers until everyone has answered or the organizer reveals them.";

const POLL_MS = 5000;

/** What the participant sent, with a way back into the form until the reveal. */
function Sent({ state, onChange }: { state: ParticipantState; onChange: () => void }) {
  const byProbe = new Map(state.ownAnswers.map((a) => [a.probeId, a]));
  return (
    <>
      <p role="status">Sent. You can change an answer until answers are revealed.</p>
      <p>{waitingLine(state.waitingOn)}</p>
      <dl className="sent-answers">
        {state.openProbes.map((p) => {
          const a = byProbe.get(p.id);
          return (
            <div key={p.id}>
              <dt>{p.stem}</dt>
              <dd>{a ? answerText(p, a) : ""}</dd>
            </div>
          );
        })}
      </dl>
      <Button variant="secondary" onClick={onChange}>
        Change an answer
      </Button>
    </>
  );
}

export function ParticipantView({
  state,
  token,
  reload,
}: {
  state: ParticipantState;
  token: string;
  reload?: (() => Promise<void>) | undefined;
}) {
  const stage = participantStage(state);
  const [changing, setChanging] = useState(false);

  // Nobody pushes the reveal to this page, so it asks again while the participant waits.
  useEffect(() => {
    if (stage !== "waiting" || changing || !reload) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [stage, changing, reload]);

  const answering = stage === "answer" || stage === "recheck" || (stage === "waiting" && changing);
  const names = new Map([[state.participant.id, "You"]]);
  const recordHref = `/p/${encodeURIComponent(token)}/record`;
  return (
    <>
      <header>
        <h1>{state.meeting.title}</h1>
        <p>You are answering as {state.participant.displayName}.</p>
      </header>
      {stage === "not_started" && (
        <p>The organizer hasn&apos;t sent any questions yet. Come back to this link later.</p>
      )}
      {answering && (
        <section aria-labelledby="questions-heading">
          <h2 id="questions-heading">
            {stage === "recheck" ? "One more question about what happens next" : "Your questions"}
          </h2>
          <p>{ANSWER_INTRO}</p>
          <AnswerForm
            probes={state.openProbes}
            ownAnswers={state.ownAnswers}
            token={token}
            onSent={async () => {
              await reload?.();
              setChanging(false);
            }}
          />
        </section>
      )}
      {stage === "waiting" && !changing && (
        <section aria-labelledby="sent-heading">
          <h2 id="sent-heading">Your answers</h2>
          <Sent state={state} onChange={() => setChanging(true)} />
        </section>
      )}
      {(stage === "reveal" || stage === "record") && (
        <section aria-labelledby="revealed-heading">
          <h2 id="revealed-heading">Revealed answers</h2>
          {state.revealed.map((r) => (
            <div key={r.split.id}>
              <ForkView
                stem={r.probe.stem}
                options={r.probe.options}
                split={r.split}
                answers={r.answers}
                names={names}
              />
              {r.split.outcome === "split" && (
                <p>
                  <StatusLabel status={r.split.status} />
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      {stage === "record" && (
        <p>
          <Link href={recordHref}>Open record</Link>
        </p>
      )}
    </>
  );
}

async function fetchState(token: string): Promise<Loaded<ParticipantState>> {
  const res = await callApi<ParticipantState>(`/api/p/${encodeURIComponent(token)}`);
  return res.ok
    ? { state: "ready", data: res.data }
    : { state: "error", message: res.message, status: res.status };
}

export function Participant({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded<ParticipantState>>({ state: "loading" });

  // A failed refresh keeps the page the participant already has.
  const reload = useCallback(async () => {
    const next = await fetchState(token);
    if (next.state === "ready") setLoaded(next);
  }, [token]);

  useEffect(() => {
    let live = true;
    void fetchState(token).then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, [token]);

  if (loaded.state === "loading") return <Loading>Opening your questions.</Loading>;
  if (loaded.state === "error") return <ErrorNotice>{loaded.message}</ErrorNotice>;
  return <ParticipantView state={loaded.data} token={token} reload={reload} />;
}
