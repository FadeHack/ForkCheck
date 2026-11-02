"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { CreateMeetingResponse } from "../../contracts/api";
import { callApi, organizerUrl } from "../api";
import {
  readDurationMs,
  RECORDING_ACCEPT,
  recordingProblem,
  uploadAndTranscribe,
  type RecordingInfo,
} from "../audio";
import { Button, ErrorNotice, Field, Toast } from "../components";
import { useToast } from "../use-toast";
import {
  serverFieldErrors,
  transcriptWarnings,
  validateMeeting,
  type FieldErrors,
  type SourceKind,
} from "./validate";

const CREATE_FAILED = "We couldn't create the meeting check. Nothing was saved. Try again.";

function absolute(url: string): string {
  return new URL(url, window.location.origin).href;
}

export function CreatedLinks({
  created,
  transcribing = false,
}: {
  created: CreateMeetingResponse;
  transcribing?: boolean;
}) {
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
    <section aria-labelledby="created-heading" className="created">
      <h2 id="created-heading">Meeting check created</h2>
      {transcribing && (
        <p>
          The recording is being transcribed. Open your workspace to follow it, then say who each
          voice is.
        </p>
      )}
      <h3>Your organizer link</h3>
      <p>Keep this link. It&apos;s the only way back to this workspace.</p>
      <ul className="link-list">
        <li className="link-organizer">
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
      <ul className="link-list link-tickets">
        {created.participantLinks.map((l) => (
          <li key={l.participantId}>
            <span className="link-name">{l.displayName}</span> <a href={l.url}>{l.url}</a>
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

  const [source, setSource] = useState<SourceKind>("paste");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState<RecordingInfo | null>(null);
  // The duration arrives after the file is chosen; a later choice must not be overwritten by it.
  const chosen = useRef<File | null>(null);
  const [participants, setParticipants] = useState("");
  const [transcript, setTranscript] = useState("");
  const warnings = useMemo(
    () => transcriptWarnings(participants, transcript),
    [participants, transcript],
  );

  function showRecording(info: RecordingInfo | null) {
    setRecording(info);
    const problem = info === null ? null : recordingProblem(info);
    setErrors(({ recording: _, ...rest }) =>
      problem === null ? rest : { ...rest, recording: problem },
    );
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    chosen.current = next;
    setFile(next);
    if (next === null) return showRecording(null);
    showRecording({ size: next.size, durationMs: null });
    void readDurationMs(next).then((durationMs) => {
      if (chosen.current === next) showRecording({ size: next.size, durationMs });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const checked = validateMeeting({
      title: text("title"),
      heldAt: text("heldAt"),
      timezone: text("timezone"),
      participants,
      source,
      transcript,
      recording,
      terms: text("terms"),
      pseudonymizeNames: form.get("pseudonymize") !== null,
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
    if (res.ok && source === "audio" && file !== null) {
      const { meetingId, organizerToken } = res.data;
      const sent = await uploadAndTranscribe(meetingId, organizerToken, file, checked.keywords);
      if (!sent.ok) {
        // A meeting without its recording is a dead end, so it goes too.
        await callApi(`/api/meetings/${encodeURIComponent(meetingId)}`, {
          method: "DELETE",
          token: organizerToken,
        });
        setSending(false);
        setFailure(`${sent.message} Nothing was saved.`);
        return;
      }
    }
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

  if (created) return <CreatedLinks created={created} transcribing={source === "audio"} />;

  return (
    <form className="start-form" onSubmit={submit} noValidate>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <div className="start-details">
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
        <Field
          id="participants"
          label="Participant names, one per line"
          error={errors.participants}
        >
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
      </div>
      <div className="start-source">
        <fieldset className="source-choice">
          <legend>How do you have the meeting?</legend>
          {(
            [
              ["paste", "Paste a transcript"],
              ["audio", "Upload a recording"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="source"
                value={value}
                checked={source === value}
                onChange={() => setSource(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {source === "paste" ? (
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
        ) : (
          <>
            <Field
              id="recording"
              label="Recording"
              hint="WAV, M4A, MP3 or WebM, up to 10 minutes and 32 MB."
              error={errors.recording}
            >
              {(d) => (
                <input
                  id="recording"
                  name="recording"
                  type="file"
                  accept={RECORDING_ACCEPT}
                  required
                  onChange={chooseFile}
                  aria-describedby={d}
                />
              )}
            </Field>
            <Field
              id="terms"
              label="Project terms, one per line (optional)"
              hint="Product names and jargon help the transcription. Participant names are added for you."
            >
              {(d) => <textarea id="terms" name="terms" rows={3} aria-describedby={d} />}
            </Field>
          </>
        )}
      </div>
      <div className="start-submit">
        <Field
          id="pseudonymize"
          check
          label="Hide participant names from the model"
          hint={
            source === "paste"
              ? "The model sees Person A, Person B and so on. Everyone here still sees real names."
              : "The model sees Person A, Person B and so on. Everyone here still sees real names. The recording is transcribed as spoken, names included."
          }
        >
          {(d) => (
            <input id="pseudonymize" name="pseudonymize" type="checkbox" aria-describedby={d} />
          )}
        </Field>
        <Field
          id="consent"
          check
          label={
            source === "paste" ? (
              <>
                Everyone in this meeting agreed to have it checked. The transcript is sent to
                Meta&apos;s model API for analysis.
              </>
            ) : (
              <>
                Everyone in this recording agreed to have it checked. The recording is sent to Meta
                for transcription, and the transcript to Meta&apos;s model API for analysis.
              </>
            )
          }
          error={errors.consent}
        >
          {(d) => (
            <input id="consent" name="consent" type="checkbox" required aria-describedby={d} />
          )}
        </Field>
        <Button type="submit" disabled={sending}>
          {sending
            ? source === "audio"
              ? "Uploading the recording"
              : "Creating meeting check"
            : "Create meeting check"}
        </Button>
      </div>
    </form>
  );
}
