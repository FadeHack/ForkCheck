"use client";

import { useSyncExternalStore } from "react";
import { Button } from "./components";

/** Why the link is being sent: first to answer, or after the reveal to settle the differences. */
export type LinkPurpose = "answer" | "settle";

/**
 * The message for one person's link. It goes out from the organizer's own mail app or share
 * sheet, so ForkCheck never holds an email address.
 */
export function linkMessage(name: string, title: string, url: string, purpose: LinkPurpose) {
  const subject =
    purpose === "answer" ? `Your questions about "${title}"` : `Settle the answers for "${title}"`;
  const lead =
    purpose === "answer"
      ? `Here is your private link for "${title}". It asks a few short questions about what we decided. Nobody sees your answers until everyone has answered.`
      : `The answers for "${title}" are in. Open your link to see where we differ and help settle the wording.`;
  const text = `Hi ${name},\n\n${lead}`;
  return {
    subject,
    text,
    body: `${text}\n\n${url}\n\nThe link is yours alone, so please don't forward it.`,
  };
}

export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const noSubscribe = () => () => {};

/** Email from the organizer's mail app, and Share where the browser has a share sheet (phones). */
export function SendLink({
  name,
  title,
  url,
  purpose,
}: {
  name: string;
  title: string;
  url: string;
  purpose: LinkPurpose;
}) {
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  const message = linkMessage(name, title, url, purpose);
  return (
    <>
      <a
        className="button button-secondary"
        href={mailtoHref(message.subject, message.body)}
        aria-label={`Email ${name}'s link`}
      >
        Email
      </a>
      {canShare && (
        <Button
          variant="secondary"
          aria-label={`Share ${name}'s link`}
          onClick={() => {
            // Dismissing the share sheet rejects; there is nothing to report.
            navigator.share({ title: message.subject, text: message.text, url }).catch(() => {});
          }}
        >
          Share
        </Button>
      )}
    </>
  );
}
