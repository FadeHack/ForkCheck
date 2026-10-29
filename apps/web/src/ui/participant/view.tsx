"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ParticipantProbe, ParticipantState } from "../../contracts/api";
import { callApi, type Loaded } from "../api";
import { ErrorNotice, ForkList, Loading } from "../components";
import { splitStatusLabel } from "../labels";
import { participantStage } from "../stages";

export const ANSWER_INTRO =
  "Answer on your own. Nobody sees your answers until everyone has answered or the organizer reveals them.";

function Questions({ probes }: { probes: ParticipantProbe[] }) {
  return (
    <ol>
      {probes.map((p) => (
        <li key={p.id}>
          <h3>{p.stem}</h3>
          <ul>
            {p.options.map((o) => (
              <li key={o.id}>{o.text}</li>
            ))}
            <li>Not sure</li>
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function ParticipantView({ state, token }: { state: ParticipantState; token: string }) {
  const stage = participantStage(state);
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
      {(stage === "answer" || stage === "recheck") && (
        <section aria-labelledby="questions-heading">
          <h2 id="questions-heading">
            {stage === "recheck" ? "One more question about what happens next" : "Your questions"}
          </h2>
          <p>{ANSWER_INTRO}</p>
          <Questions probes={state.openProbes} />
        </section>
      )}
      {stage === "waiting" && (
        <p role="status">Sent. You can change an answer until answers are revealed.</p>
      )}
      {(stage === "reveal" || stage === "record") && (
        <section aria-labelledby="revealed-heading">
          <h2 id="revealed-heading">Revealed answers</h2>
          {state.revealed.map((r) => (
            <div key={r.split.id}>
              <ForkList
                stem={r.probe.stem}
                options={r.probe.options}
                split={r.split}
                answers={r.answers}
                names={names}
              />
              {r.split.outcome === "split" && (
                <p>
                  <strong>{splitStatusLabel[r.split.status]}</strong>
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

export function Participant({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded<ParticipantState>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    async function load() {
      const res = await callApi<ParticipantState>(`/api/p/${encodeURIComponent(token)}`);
      if (!live) return;
      setLoaded(
        res.ok
          ? { state: "ready", data: res.data }
          : { state: "error", message: res.message, status: res.status },
      );
    }
    void load();
    return () => {
      live = false;
    };
  }, [token]);

  if (loaded.state === "loading") return <Loading>Opening your questions.</Loading>;
  if (loaded.state === "error") return <ErrorNotice>{loaded.message}</ErrorNotice>;
  return <ParticipantView state={loaded.data} token={token} />;
}
