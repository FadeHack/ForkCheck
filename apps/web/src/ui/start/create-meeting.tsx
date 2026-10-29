"use client";

import { useState, type FormEvent } from "react";
import type { CreateMeetingRequest, CreateMeetingResponse } from "../../contracts/api";
import type { ValidationError } from "../../server/http";
import { callApi, organizerUrl } from "../api";
import { Button, ErrorNotice, Field, Toast } from "../components";
import { wallTimeToInstant } from "../time";
import { useToast } from "../use-toast";

const CREATE_FAILED = "We couldn't create the meeting check. Nothing was saved. Try again.";

/** Field errors keyed by form field; the API reports `participants.1` style paths. */
type Field = "title" | "heldAt" | "timezone" | "participants" | "transcript" | "consent";
type FieldErrors = Partial<Record<Field, string>>;
const API_FIELDS: readonly string[] = ["title", "heldAt", "timezone", "participants", "transcript"];

function fieldErrors(body: unknown): FieldErrors {
  const fields = (body as ValidationError | null)?.error?.fields ?? {};
  const out: FieldErrors = {};
  for (const [path, messages] of Object.entries(fields)) {
    const key = path.split(".")[0] ?? "";
    if (API_FIELDS.includes(key)) out[key as Field] ??= messages.join(" ");
  }
  return out;
}

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const timezone = text("timezone");
    const heldAt = wallTimeToInstant(text("heldAt"), timezone);
    const local: FieldErrors = {};
    if (heldAt === null) {
      local.heldAt = "Enter the date and time the meeting started, in the time zone below.";
    }
    if (form.get("consent") === null) {
      local.consent = "Confirm that everyone agreed to have this meeting checked.";
    }
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }
    const body: CreateMeetingRequest = {
      title: text("title"),
      heldAt: heldAt!,
      timezone,
      participants: text("participants")
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean),
      transcript: text("transcript"),
    };
    setSending(true);
    setFailure(null);
    const res = await callApi<CreateMeetingResponse>("/api/meetings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSending(false);
    if (res.ok) {
      setErrors({});
      setCreated(res.data);
      return;
    }
    const fields = fieldErrors(res.body);
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
          <textarea id="participants" name="participants" rows={4} required aria-describedby={d} />
        )}
      </Field>
      <Field
        id="transcript"
        label="Transcript"
        hint={
          <>One line per turn, starting with the speaker&apos;s name: &quot;Dana: text&quot;.</>
        }
        error={errors.transcript}
      >
        {(d) => (
          <textarea id="transcript" name="transcript" rows={12} required aria-describedby={d} />
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
