"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ParticipantState } from "../../contracts/api";
import { callApi, type Loaded } from "../api";
import { Button, Loading, PageError } from "../components";
import { waitingLine } from "../labels";
import { RevealList } from "../reveal";
import { participantStage, type ParticipantStage } from "../stages";
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
      <p role="status">{waitingLine(state.waitingOn)}</p>
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

const arrived: Partial<Record<ParticipantStage, string>> = {
  answer: "Your questions have arrived.",
  recheck: "One more question has arrived.",
  reveal: "Everyone's answers are now shown on this page.",
  record: "The record is ready.",
};

/**
 * Announces a stage this page moved to while open, once. Polling swaps the content without a
 * page load, so a screen reader would otherwise not hear that the answers were revealed.
 */
function StageAnnouncer({ stage }: { stage: ParticipantStage }) {
  const shown = useRef(stage);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (shown.current === stage) return;
    shown.current = stage;
    setMessage(arrived[stage] ?? "");
  }, [stage]);
  return (
    <p role="status" className="visually-hidden">
      {message}
    </p>
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

  // Nothing pushes changes to this page, so it asks again unless the participant is typing.
  const live = stage === "not_started" || stage === "waiting" || stage === "reveal";
  useEffect(() => {
    if (!live || changing || !reload) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, changing, reload]);

  const answering = stage === "answer" || stage === "recheck" || (stage === "waiting" && changing);
  const recordHref = `/p/${encodeURIComponent(token)}/record`;
  return (
    <>
      <header>
        <h1>{state.meeting.title}</h1>
        <p>You are answering as {state.participant.displayName}.</p>
      </header>
      <StageAnnouncer stage={stage} />
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
        <RevealList
          items={state.revealed}
          people={state.participants}
          actor={{ token, viewerId: state.participant.id, onChange: reload }}
        />
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
  if (loaded.state === "error") {
    return <PageError title="Your questions didn't open">{loaded.message}</PageError>;
  }
  return <ParticipantView state={loaded.data} token={token} reload={reload} />;
}
