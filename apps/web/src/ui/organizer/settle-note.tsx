"use client";

import type { Participant } from "@forkcheck/core";
import { useSavedMeetings } from "../saved-meetings";
import { SendLink } from "../send-link";

/**
 * After the reveal the workspace has no controls: wording is proposed and confirmed from each
 * person's own link. Without this note the organizer is left looking at a page with nothing to do.
 */
export function SettleOnLinks({
  meetingId,
  title,
  participants,
}: {
  meetingId: string;
  title: string;
  participants: Participant[];
}) {
  const saved = useSavedMeetings()?.find((m) => m.id === meetingId)?.participants ?? [];
  const active = new Set(participants.filter((p) => p.status === "active").map((p) => p.id));
  const links = saved.filter((l) => active.has(l.participantId));
  return (
    <section className="settle-note" aria-labelledby="settle-heading">
      <h2 id="settle-heading">Next: settle each difference from the participant links</h2>
      <p>
        On their own link, anyone can propose wording that settles a difference, or ask for a draft.
        Everyone then confirms it, or they agree to disagree. This page follows along. When every
        difference is settled, you send a recheck question from here.
      </p>
      {links.length > 0 && (
        <p id="settle-new-tab" className="field-hint">
          Each link opens in a new tab.
        </p>
      )}
      {links.length > 0 ? (
        <ul className="link-list link-tickets" aria-describedby="settle-new-tab">
          {links.map((l) => (
            <li key={l.participantId}>
              <span className="link-name">{l.name}</span>{" "}
              <a href={l.url} target="_blank" rel="noopener">
                {l.url}
              </a>
              <span className="link-actions">
                <SendLink name={l.name} title={title} url={l.url} purpose="settle" />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>Use the links you sent each person when you created this check.</p>
      )}
    </section>
  );
}
