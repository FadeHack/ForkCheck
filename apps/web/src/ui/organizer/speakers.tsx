"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { speakerLabels, type Segment } from "@forkcheck/core";
import type {
  MapSpeakersResponse,
  MeetingProgressResponse,
  OrganizerMeetingState,
} from "../../contracts/api";
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
import { PlayButton, PlayerFailure, useTurnPlayer } from "./player";

type State = OrganizerMeetingState;
type Reload = (() => Promise<void>) | undefined;

const POLL_MS = 3000;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SpeakersView({ state, onChange }: { state: State; onChange?: Reload }) {
  const { status, transcriptVersion } = state.meeting;
  return (
    <section aria-labelledby="speakers-heading">
      <h2 id="speakers-heading">Speakers</h2>
      {status === "transcribing" ? (
        <Transcribing state={state} onChange={onChange} />
      ) : transcriptVersion === 0 ? (
        <NeedsTranscription state={state} onChange={onChange} />
      ) : status === "review" ? (
        <SpeakerMapper state={state} onChange={onChange} />
      ) : (
        <SavedSpeakers state={state} />
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

/** Turns per label, in the order the voices first speak. */
function voices(segments: Segment[]): { label: string; turns: Segment[] }[] {
  return speakerLabels(segments).map((label) => ({
    label,
    turns: segments.filter((s) => s.speakerLabel === label),
  }));
}

// Transcribed turns carry times; the text length stands in when one doesn't.
const length = (s: Segment) =>
  s.startMs !== null && s.endMs !== null ? s.endMs - s.startMs : s.text.length;

/** The three longest turns, the easiest to recognize a voice by, kept in transcript order. */
export function sampleTurns(turns: Segment[]): Segment[] {
  const longest = new Set(turns.toSorted((a, b) => length(b) - length(a)).slice(0, 3));
  return turns.filter((t) => longest.has(t));
}

const UNKNOWN = "unknown";

function Summary({ state }: { state: State }) {
  const duration = state.audio?.durationMs;
  const labels = speakerLabels(state.segments).length;
  return (
    <p>
      {duration != null && `Transcribed ${formatDuration(duration)} of audio: `}
      {count(state.segments.length, "turn", "turns")} from {count(labels, "voice", "voices")}.
    </p>
  );
}

/** Label → participant, or "unknown"; each voice's choice starts from the saved mapping. */
function SpeakerMapper({ state, onChange }: { state: State; onChange: Reload }) {
  const id = state.meeting.id;
  const groups = voices(state.segments);
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(state.speakers.map((m) => [m.label, m.participantId ?? UNKNOWN] as const)),
  );
  const [checked, setChecked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const player = useTurnPlayer(id);
  const open = groups.filter((g) => !choice[g.label]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(true);
    if (open.length > 0) {
      document.getElementById(`speaker-${open[0]!.label}`)?.focus();
      return;
    }
    const mapping = Object.fromEntries(
      groups.map(({ label }) => [label, choice[label] === UNKNOWN ? null : choice[label]!]),
    );
    setSending(true);
    const res = await organizerCall(id)<MapSpeakersResponse>(
      `/api/meetings/${encodeURIComponent(id)}/speakers`,
      { method: "PUT", body: JSON.stringify({ mapping }) },
    );
    setSending(false);
    if (!res.ok) return setFailure(res.message);
    setFailure(null);
    await onChange?.();
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby="speakers-intro">
      <Summary state={state} />
      <p id="speakers-intro">
        Say who each voice is. Two voices can be the same person. Choose Unknown for anyone who
        isn&apos;t a participant.
      </p>
      {state.audio === null && (
        <p>The recording isn&apos;t stored any more, so turns can&apos;t be played.</p>
      )}
      {player.element}
      <PlayerFailure player={player} />
      {checked && open.length > 0 && (
        <ErrorNotice>Map every speaker or mark them Unknown to continue.</ErrorNotice>
      )}
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      {groups.map(({ label, turns }) => (
        <fieldset key={label} className="voice">
          <legend>
            Speaker {label}{" "}
            <span className="voice-count">({count(turns.length, "turn", "turns")})</span>
          </legend>
          <ul className="voice-turns">
            {sampleTurns(turns).map((t) => (
              <li key={t.id}>
                <p>{t.text}</p>
                {state.audio !== null && <PlayButton player={player} turn={t} />}
              </li>
            ))}
          </ul>
          <Field
            id={`speaker-${label}`}
            label={`Who is Speaker ${label}?`}
            error={
              checked && !choice[label] ? `Choose who Speaker ${label} is, or Unknown.` : undefined
            }
          >
            {(d) => (
              <select
                id={`speaker-${label}`}
                value={choice[label] ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setChoice((c) => ({ ...c, [label]: e.target.value }))
                }
                aria-describedby={d}
              >
                <option value="">Choose a person</option>
                {state.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
                <option value={UNKNOWN}>Unknown</option>
              </select>
            )}
          </Field>
        </fieldset>
      ))}
      <Button type="submit" disabled={sending}>
        {sending ? "Saving speakers" : "Save speakers"}
      </Button>
    </form>
  );
}

/** After questions are drafted the mapping is fixed; it stays visible for reference. */
function SavedSpeakers({ state }: { state: State }) {
  const names = new Map(state.participants.map((p) => [p.id, p.displayName]));
  return (
    <>
      <Summary state={state} />
      <ul>
        {state.speakers.map((m) => (
          <li key={m.label}>
            Speaker {m.label}:{" "}
            {m.participantId === null ? "Unknown" : (names.get(m.participantId) ?? "Unknown")}
          </li>
        ))}
      </ul>
    </>
  );
}
