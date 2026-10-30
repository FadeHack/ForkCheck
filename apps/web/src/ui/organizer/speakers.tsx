"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { MeetingProgressResponse, OrganizerMeetingState } from "../../contracts/api";
import { organizerCall, organizerToken } from "../api";
import {
  formatDuration,
  readDurationMs,
  RECORDING_ACCEPT,
  recordingProblem,
  startTranscription,
  uploadAndTranscribe,
  type RecordingInfo,
} from "../audio";
import { Button, ErrorNotice, Field, Loading } from "../components";

type State = OrganizerMeetingState;
type Reload = (() => Promise<void>) | undefined;

const POLL_MS = 3000;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SpeakersView({ state, onChange }: { state: State; onChange?: Reload }) {
  const { status } = state.meeting;
  return (
    <section aria-labelledby="speakers-heading">
      <h2 id="speakers-heading">Speakers</h2>
      {status === "transcribing" ? (
        <Transcribing state={state} onChange={onChange} />
      ) : status === "review" ? (
        <TranscriptReady state={state} />
      ) : (
        <NeedsTranscription state={state} onChange={onChange} />
      )}
    </section>
  );
}

/** Polls progress and reloads the workspace once transcription has finished or failed. */
function Transcribing({ state, onChange }: { state: State; onChange: Reload }) {
  const id = state.meeting.id;
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const call = organizerCall(id);
    let done = false;
    const timer = setInterval(async () => {
      const res = await call<MeetingProgressResponse>(
        `/api/meetings/${encodeURIComponent(id)}/progress`,
      );
      // A failed poll keeps the page as it is; the next one may get through.
      if (!res.ok || done) return;
      if (res.data.status === "transcribing") return setStalled(res.data.stalled);
      done = true;
      clearInterval(timer);
      await onChange?.();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, onChange]);

  if (!stalled) {
    return <Loading>Transcribing the recording. This page updates when it&apos;s done.</Loading>;
  }
  return (
    <>
      <ErrorNotice>Transcription has shown no progress for 10 minutes. Start it again.</ErrorNotice>
      <StartButton state={state} onChange={onChange} label="Start transcription again" />
    </>
  );
}

function StartButton({
  state,
  onChange,
  label,
}: {
  state: State;
  onChange: Reload;
  label: string;
}) {
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const audio = state.audio;
  if (audio === null) return null;

  async function start(storageKey: string) {
    const id = state.meeting.id;
    setSending(true);
    const res = await startTranscription(id, organizerToken(id) ?? "", storageKey);
    setSending(false);
    if (!res.ok) return setFailure(res.message);
    setFailure(null);
    await onChange?.();
  }

  return (
    <>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <Button disabled={sending} onClick={() => start(audio.storageKey)}>
        {sending ? "Starting transcription" : label}
      </Button>
    </>
  );
}

/** Before a transcript exists: after a failure, or when the upload never reached transcription. */
function NeedsTranscription({ state, onChange }: { state: State; onChange: Reload }) {
  const { status, error } = state.meeting;
  const stored = state.audio !== null;
  return (
    <>
      {status === "failed" && <ErrorNotice>{`Transcription failed. ${error ?? ""}`}</ErrorNotice>}
      {stored && status !== "failed" && (
        <p>The recording is uploaded but hasn&apos;t been transcribed yet.</p>
      )}
      {stored && (
        <StartButton
          state={state}
          onChange={onChange}
          label={status === "failed" ? "Start transcription again" : "Start transcription"}
        />
      )}
      <UploadForm
        meetingId={state.meeting.id}
        heading={stored ? "Upload a different recording" : "Upload the recording"}
        onChange={onChange}
      />
    </>
  );
}

function UploadForm({
  meetingId,
  heading,
  onChange,
}: {
  meetingId: string;
  heading: string;
  onChange: Reload;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const chosen = useRef<File | null>(null);

  function show(info: RecordingInfo | null) {
    setProblem(info === null ? null : recordingProblem(info));
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    chosen.current = next;
    setFile(next);
    if (next === null) return show(null);
    show({ size: next.size, durationMs: null });
    void readDurationMs(next).then((durationMs) => {
      if (chosen.current === next) show({ size: next.size, durationMs });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = file === null ? recordingProblem(null) : problem;
    if (issue !== null || file === null) return setProblem(issue);
    setSending(true);
    const res = await uploadAndTranscribe(meetingId, organizerToken(meetingId) ?? "", file);
    setSending(false);
    if (!res.ok) return setFailure(res.message);
    setFailure(null);
    await onChange?.();
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="upload-heading">
      <h3 id="upload-heading">{heading}</h3>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <Field
        id="recording"
        label="Recording"
        hint="WAV, M4A, MP3 or WebM, up to 10 minutes and 32 MB."
        error={problem ?? undefined}
      >
        {(d) => (
          <input
            id="recording"
            name="recording"
            type="file"
            accept={RECORDING_ACCEPT}
            required
            onChange={choose}
            aria-describedby={d}
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" disabled={sending}>
        {sending ? "Uploading the recording" : "Upload and transcribe"}
      </Button>
    </form>
  );
}

/** What transcription found, until voices can be matched to participants here. */
function TranscriptReady({ state }: { state: State }) {
  const turns = new Map<string, number>();
  for (const s of state.segments) {
    const label = s.speakerLabel === null ? "No speaker label" : `Speaker ${s.speakerLabel}`;
    turns.set(label, (turns.get(label) ?? 0) + 1);
  }
  const duration = state.audio?.durationMs;
  return (
    <>
      <p>
        {duration != null && `Transcribed ${formatDuration(duration)} of audio: `}
        {count(state.segments.length, "turn", "turns")} from {count(turns.size, "voice", "voices")}.
      </p>
      <ul>
        {[...turns].map(([label, n]) => (
          <li key={label}>
            {label}: {count(n, "turn", "turns")}
          </li>
        ))}
      </ul>
      <p>Matching voices to participants isn&apos;t available yet.</p>
    </>
  );
}
