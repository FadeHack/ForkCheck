"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { OrganizerMeetingState } from "../../contracts/api";
import { callApi, MISSING_KEY, organizerToken, type Loaded } from "../api";
import { Loading, PageError } from "../components";
import { ReplayedBanner } from "../replayed-banner";
import { SimulatedBanner } from "../simulated-banner";
import { organizerStage, stagesFor, type OrganizerStage, type StageList } from "../stages";
import { formatHeldAt } from "../time";
import { QuestionsView } from "./questions";
import { RoundMonitor } from "./round";
import { RecheckView } from "./recheck";
import { ReviewView } from "./review";
import { SpeakersView } from "./speakers";
import { TracePanel } from "./trace";
import { DeleteMeeting, MeetingDeleted } from "./delete";
import { RecordLink, RevealView, StageRail } from "./views";

const POLL_MS = 5000;

/** Shows an earlier stage when `?stage=` names one; never a stage the meeting hasn't reached. */
export function viewedStage(
  current: OrganizerStage,
  requested: string | null,
  stages: StageList,
): OrganizerStage {
  const idx = (id: string | null) => stages.findIndex((s) => s.id === id);
  const r = idx(requested);
  return r > 0 && r <= idx(current) ? stages[r]!.id : current;
}

export function WorkspaceView({
  state,
  viewing,
  reload,
  onDeleted = () => {},
}: {
  state: OrganizerMeetingState;
  viewing: string | null;
  /** Fetches the state again after an action changed it. */
  reload?: () => Promise<void>;
  onDeleted?: () => void;
}) {
  const current = organizerStage(state);
  const stages = stagesFor(state.meeting);
  const stage = viewedStage(current, viewing, stages);
  const id = state.meeting.id;
  const href = (s: OrganizerStage) => `/m/${encodeURIComponent(id)}?stage=${s}`;
  return (
    <>
      <header>
        <h1>{state.meeting.title}</h1>
        <p>Held {formatHeldAt(state.meeting.heldAt, state.meeting.timezone)}</p>
      </header>
      {state.participants.some((p) => p.isSimulated) && <SimulatedBanner />}
      <ReplayedBanner replayed={state.replayed} />
      <StageRail stages={stages} current={current} viewing={stage} href={href} />
      {stage === "speakers" && <SpeakersView state={state} onChange={reload} />}
      {stage === "review" && <ReviewView state={state} onChange={reload} />}
      {stage === "questions" && (
        // Remounts when drafting finishes, so the selection starts from the new drafts.
        <QuestionsView key={state.meeting.status} state={state} onChange={reload} />
      )}
      {stage === "round" && <RoundMonitor state={state} onChange={reload} />}
      {(stage === "reveal" || stage === "resolve") && <RevealView state={state} />}
      {stage === "recheck" && <RecheckView state={state} onChange={reload} />}
      {stage === "record" && <RecordLink meetingId={id} />}
      <TracePanel meetingId={id} />
      <DeleteMeeting state={state} onDeleted={onDeleted} />
    </>
  );
}

async function fetchState(meetingId: string): Promise<Loaded<OrganizerMeetingState>> {
  const token = organizerToken(meetingId);
  if (token === null) return { state: "error", message: MISSING_KEY, status: null };
  const res = await callApi<OrganizerMeetingState>(
    `/api/meetings/${encodeURIComponent(meetingId)}`,
    { token },
  );
  return res.ok
    ? { state: "ready", data: res.data }
    : { state: "error", message: res.message, status: res.status };
}

export function Workspace({ meetingId }: { meetingId: string }) {
  const [loaded, setLoaded] = useState<Loaded<OrganizerMeetingState>>({ state: "loading" });
  const [deleted, setDeleted] = useState(false);
  const viewing = useSearchParams().get("stage");

  // A reload keeps the current state on screen until the new one arrives, so open forms stay mounted.
  const reload = useCallback(async () => setLoaded(await fetchState(meetingId)), [meetingId]);

  useEffect(() => {
    let live = true;
    void fetchState(meetingId).then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, [meetingId]);

  // Answers, labels and confirmations arrive from other people's phones. Drafting has its own
  // progress check, and the record no longer changes.
  const live =
    !deleted &&
    loaded.state === "ready" &&
    ["round", "reveal", "resolve", "recheck"].includes(organizerStage(loaded.data));
  useEffect(() => {
    if (!live) return;
    // A failed refresh keeps the page the organizer already has.
    const timer = setInterval(async () => {
      const next = await fetchState(meetingId);
      if (next.state === "ready") setLoaded(next);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, meetingId]);

  if (deleted) return <MeetingDeleted />;
  if (loaded.state === "loading") return <Loading>Opening the meeting check.</Loading>;
  if (loaded.state === "error") {
    return <PageError title="This meeting check didn't open">{loaded.message}</PageError>;
  }
  return (
    <WorkspaceView
      state={loaded.data}
      viewing={viewing}
      reload={reload}
      onDeleted={() => setDeleted(true)}
    />
  );
}
