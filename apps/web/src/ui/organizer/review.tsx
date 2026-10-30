"use client";

import Link from "next/link";
import { useState } from "react";
import type { AnalyzeResponse, OrganizerMeetingState } from "../../contracts/api";
import { organizerCall } from "../api";
import { Button, ErrorNotice, Loading, timestamp } from "../components";
import { turnSpeaker } from "../labels";

type State = OrganizerMeetingState;

export function ReviewView({
  state,
  onChange,
}: {
  state: State;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const id = state.meeting.id;
  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Transcript review</h2>
      <p>
        Read the transcript before questions are drafted from it.{" "}
        <Link href={`/m/${encodeURIComponent(id)}?stage=speakers`}>Change who each voice is</Link>.
      </p>
      <ol className="turns">
        {state.segments.map((s) => (
          <li key={s.id}>
            <p className="turn-speaker">
              {turnSpeaker(s, state.participants)}
              {s.startMs !== null && <> at {timestamp(s.startMs)}</>}
            </p>
            <p className="turn-text">{s.text}</p>
          </li>
        ))}
      </ol>
      <FinishReview state={state} onChange={onChange} />
    </section>
  );
}

/** Drafts questions from the reviewed transcript; the workspace then moves to Questions. */
function FinishReview({
  state,
  onChange,
}: {
  state: State;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const id = state.meeting.id;
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function finish() {
    setRunning(true);
    setFailure(null);
    const res = await organizerCall(id)<AnalyzeResponse>(
      `/api/meetings/${encodeURIComponent(id)}/analyze`,
      { method: "POST" },
    );
    setRunning(false);
    if (!res.ok) setFailure(res.message);
    await onChange?.();
  }

  if (running) return <Loading>Reading the transcript and drafting questions.</Loading>;
  return (
    <>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <Button onClick={finish}>Finish review</Button>
    </>
  );
}
