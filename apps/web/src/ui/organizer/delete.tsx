"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrganizerMeetingState } from "../../contracts/api";
import { organizerCall } from "../api";
import { Button, ErrorNotice, Loading } from "../components";
import { formatDay } from "../time";

/** When the meeting goes by itself, and a button to delete it now after one confirmation. */
export function DeleteMeeting({
  state,
  onDeleted,
}: {
  state: OrganizerMeetingState;
  onDeleted: () => void;
}) {
  const { id, deleteAfter, timezone } = state.meeting;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setFailure(null);
    const res = await organizerCall(id)(`/api/meetings/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (res.ok) return onDeleted();
    setConfirming(false);
    setFailure(res.message);
  }

  return (
    <section className="delete-meeting" aria-labelledby="delete-heading">
      <h2 id="delete-heading">Delete this meeting check</h2>
      <p>
        {deleteAfter === null
          ? "It is kept until you delete it."
          : `It is deleted automatically on ${formatDay(deleteAfter, timezone)}.`}{" "}
        That removes the transcript, the questions, everyone&apos;s answers, the record and any kept
        recording, and every link to it stops working.
      </p>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      {deleting ? (
        <Loading>Deleting the meeting check.</Loading>
      ) : confirming ? (
        <>
          <p>
            <strong>This can&apos;t be undone.</strong> Participants lose their copy of the record
            too.
          </p>
          <div className="actions">
            <Button onClick={remove}>Delete everything</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Delete now
        </Button>
      )}
    </section>
  );
}

export function MeetingDeleted() {
  return (
    <>
      <h1>Meeting check deleted</h1>
      <p>
        The transcript, answers and record are gone, and the links to this meeting check no longer
        work.
      </p>
      <p>
        <Link href="/">Start a new meeting check</Link>
      </p>
    </>
  );
}
