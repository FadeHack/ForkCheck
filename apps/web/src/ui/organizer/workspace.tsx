"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { OrganizerMeetingState } from "../../contracts/api";
import { callApi, organizerToken, type Loaded } from "../api";
import { ErrorNotice, Loading } from "../components";
import { organizerStage, organizerStages, type OrganizerStage } from "../stages";
import { formatHeldAt } from "../time";
import {
  QuestionsView,
  RecheckView,
  RecordLink,
  ResolveView,
  RevealView,
  RoundView,
  StageRail,
} from "./views";

export const MISSING_KEY =
  "This workspace link is missing its key. Open the organizer link you kept when you created the meeting check.";

/** Shows an earlier stage when `?stage=` names one; never a stage the meeting hasn't reached. */
export function viewedStage(current: OrganizerStage, requested: string | null): OrganizerStage {
  const idx = (id: string | null) => organizerStages.findIndex((s) => s.id === id);
  const r = idx(requested);
  return r > 0 && r <= idx(current) ? organizerStages[r]!.id : current;
}

export function WorkspaceView({
  state,
  viewing,
}: {
  state: OrganizerMeetingState;
  viewing: string | null;
}) {
  const current = organizerStage(state);
  const stage = viewedStage(current, viewing);
  const id = state.meeting.id;
  const href = (s: OrganizerStage) => `/m/${encodeURIComponent(id)}?stage=${s}`;
  return (
    <>
      <header>
        <h1>{state.meeting.title}</h1>
        <p>Held {formatHeldAt(state.meeting.heldAt, state.meeting.timezone)}</p>
      </header>
      <StageRail current={current} viewing={stage} href={href} />
      {stage === "questions" && <QuestionsView state={state} />}
      {stage === "round" && <RoundView state={state} />}
      {stage === "reveal" && <RevealView state={state} />}
      {stage === "resolve" && <ResolveView state={state} />}
      {stage === "recheck" && <RecheckView state={state} />}
      {stage === "record" && <RecordLink meetingId={id} />}
    </>
  );
}

export function Workspace({ meetingId }: { meetingId: string }) {
  const [loaded, setLoaded] = useState<Loaded<OrganizerMeetingState>>({ state: "loading" });
  const viewing = useSearchParams().get("stage");

  useEffect(() => {
    let live = true;
    async function load() {
      const token = organizerToken(meetingId);
      if (token === null) {
        setLoaded({ state: "error", message: MISSING_KEY, status: null });
        return;
      }
      const res = await callApi<OrganizerMeetingState>(
        `/api/meetings/${encodeURIComponent(meetingId)}`,
        { token },
      );
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
  }, [meetingId]);

  if (loaded.state === "loading") return <Loading>Opening the meeting check.</Loading>;
  if (loaded.state === "error") return <ErrorNotice>{loaded.message}</ErrorNotice>;
  return <WorkspaceView state={loaded.data} viewing={viewing} />;
}
