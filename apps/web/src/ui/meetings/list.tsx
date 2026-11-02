"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OrganizerMeetingState } from "../../contracts/api";
import { callApi, organizerUrl } from "../api";
import { Button, Loading } from "../components";
import { forgetMeeting, useSavedMeetings, type SavedMeeting } from "../saved-meetings";
import { organizerStage, stagesFor } from "../stages";
import { formatHeldAt } from "../time";

type Where =
  | { state: "loading" }
  | { state: "ready"; stage: string; done: boolean }
  /** Deleted, or past its retention: the token no longer opens anything. */
  | { state: "gone" }
  | { state: "error" };

async function whereIs(m: SavedMeeting): Promise<Where> {
  const res = await callApi<OrganizerMeetingState>(`/api/meetings/${encodeURIComponent(m.id)}`, {
    token: m.token,
  });
  if (!res.ok)
    return res.status === 401 || res.status === 404 ? { state: "gone" } : { state: "error" };
  const stage = organizerStage(res.data);
  const label = stagesFor(res.data.meeting).find((s) => s.id === stage)?.label ?? stage;
  return { state: "ready", stage: label, done: stage === "record" };
}

function MeetingRow({ meeting }: { meeting: SavedMeeting }) {
  const [where, setWhere] = useState<Where>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void whereIs(meeting).then((w) => {
      if (live) setWhere(w);
    });
    return () => {
      live = false;
    };
  }, [meeting]);

  return (
    <li className="meeting-row" data-state={where.state}>
      <div className="meeting-name">
        {where.state === "gone" ? (
          <p className="meeting-title">{meeting.title}</p>
        ) : (
          <a className="meeting-title" href={organizerUrl(meeting.id, meeting.token)}>
            {meeting.title}
          </a>
        )}
        <p className="meeting-held">Held {formatHeldAt(meeting.heldAt, meeting.timezone)}</p>
      </div>
      <p className="meeting-where" role="status">
        {where.state === "loading" && "Checking where it is"}
        {where.state === "ready" && (where.done ? "Record ready" : <>At {where.stage}</>)}
        {where.state === "gone" && "Deleted, or its 7 days ran out"}
        {where.state === "error" && "Couldn't check where it is. Open it to see."}
      </p>
      <Button
        variant="secondary"
        aria-label={`Remove "${meeting.title}" from this list`}
        onClick={() => forgetMeeting(meeting.id)}
      >
        Remove
      </Button>
    </li>
  );
}

export function MeetingList() {
  const saved = useSavedMeetings();
  if (saved === null) return <Loading>Reading this browser&apos;s list.</Loading>;
  if (saved.length === 0) {
    return (
      <div className="meetings-empty">
        <p>No meeting checks in this browser yet. The ones you start here will be listed.</p>
        <div className="actions">
          <Link className="button button-primary" href="/new">
            Check a meeting
          </Link>
          <Link className="button button-secondary" href="/new?sample">
            Try the sample meeting
          </Link>
        </div>
      </div>
    );
  }
  return (
    <ul className="meeting-list">
      {saved.map((m) => (
        <MeetingRow key={m.id} meeting={m} />
      ))}
    </ul>
  );
}
