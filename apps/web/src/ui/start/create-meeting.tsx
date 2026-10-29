"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { CreateMeetingResponse } from "../../contracts/api";
import { callApi, organizerUrl } from "../api";
import { Button, ErrorNotice, Field, Toast } from "../components";
import { useToast } from "../use-toast";
import {
  serverFieldErrors,
  transcriptWarnings,
  validateMeeting,
  type FieldErrors,
} from "./validate";

const CREATE_FAILED = "We couldn't create the meeting check. Nothing was saved. Try again.";

function absolute(url: string): string {
  return new URL(url, window.location.origin).href;
}

export function CreatedLinks({ created }: { created: CreateMeetingResponse }) {
  const organizer = organizerUrl(created.meetingId, created.organizerToken);
  const [toast, showToast] = useToast();

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(absolute(url));
      showToast("Link copied");
    } catch {
      showToast("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <section aria-labelledby="created-heading">
      <h2 id="created-heading">Meeting check created</h2>
      <h3>Your organizer link</h3>
      <p>Keep this link. It&apos;s the only way back to this workspace.</p>
      <ul className="link-list">
        <li>
          <a href={organizer}>{organizer}</a>
          <Button
            variant="secondary"
            aria-label="Copy link to your workspace"
            onClick={() => copy(organizer)}
          >
            Copy link
          </Button>
        </li>
      </ul>
      <h3>Participant links</h3>
      <p>Send each person their own link. Each link opens that person&apos;s private questions.</p>
      <ul className="link-list">
        {created.participantLinks.map((l) => (
          <li key={l.participantId}>
            {l.displayName}: <a href={l.url}>{l.url}</a>
            <Button
              variant="secondary"
              aria-label={`Copy link for ${l.displayName}`}
              onClick={() => copy(l.url)}
            >
              Copy link
            </Button>
          </li>
        ))}
      </ul>
      <Toast message={toast} />
    </section>
  );
}

/** Prefills the browser's zone after hydration, so server and client markup agree. */
function fillBrowserZone(input: HTMLInputElement | null) {
  if (input && input.value === "") input.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function CreateMeeting() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<CreateMeetingResponse | null>(null);

  const [participants, setParticipants] = useState("");
  const [transcript, setTranscript] = useState("");
  const warnings = useMemo(
    () => transcriptWarnings(participants, transcript),
    [participants, transcript],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const checked = validateMeeting({
      title: text("title"),
      heldAt: text("heldAt"),
      timezone: text("timezone"),
      participants,
      transcript,
      consent: form.get("consent") !== null,
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      setFailure(null);
      return;
    }
    setSending(true);
    setFailure(null);
    const res = await callApi<CreateMeetingResponse>("/api/meetings", {
      method: "POST",
      body: JSON.stringify(checked.body),
    });
    setSending(false);
    if (res.ok) {
      setErrors({});
      setCreated(res.data);
      return;
    }
    const fields = serverFieldErrors(res.body);
    setErrors(fields);
    setFailure(Object.keys(fields).length > 0 ? res.message : CREATE_FAILED);
  }

  if (created) return <CreatedLinks created={created} />;

  return (
    <form onSubmit={submit} noValidate>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <Field id="title" label="Meeting title" error={errors.title}>
        {(d) => <input id="title" name="title" required aria-describedby={d} />}
      </Field>
      <Field id="heldAt" label="Meeting date and time" error={errors.heldAt}>
        {(d) => (
          <input id="heldAt" name="heldAt" type="datetime-local" required aria-describedby={d} />
        )}
      </Field>
      <Field id="timezone" label="Time zone" error={errors.timezone}>
        {(d) => (
          <input
            id="timezone"
            name="timezone"
            ref={fillBrowserZone}
            required
            aria-describedby={d}
          />
        )}
      </Field>
      <Field id="participants" label="Participant names, one per line" error={errors.participants}>
        {(d) => (
          <textarea
            id="participants"
            name="participants"
            rows={4}
            required
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            aria-describedby={d}
          />
        )}
      </Field>
      <Field
        id="transcript"
        label="Transcript"
        hint={
          <>One line per turn, starting with the speaker&apos;s name: &quot;Dana: text&quot;.</>
        }
        warning={warnings.length > 0 ? warnings.map((w) => <p key={w}>{w}</p>) : undefined}
        error={errors.transcript}
      >
        {(d) => (
          <textarea
            id="transcript"
            name="transcript"
            rows={12}
            required
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            aria-describedby={d}
          />
        )}
      </Field>
      <Field
        id="consent"
        check
        label={
          <>
            Everyone in this meeting agreed to have it checked. The transcript is sent to
            Meta&apos;s model API for analysis.
          </>
        }
        error={errors.consent}
      >
        {(d) => <input id="consent" name="consent" type="checkbox" required aria-describedby={d} />}
      </Field>
      <Button type="submit" disabled={sending}>
        {sending ? "Creating meeting check" : "Create meeting check"}
      </Button>
    </form>
  );
}
