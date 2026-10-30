"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Participant, Segment } from "@forkcheck/core";
import type {
  AnalyzeResponse,
  EditSegmentRequest,
  EditSegmentResponse,
  FinishReviewResponse,
  OrganizerMeetingState,
  SegmentEdit,
} from "../../contracts/api";
import { organizerCall } from "../api";
import { Button, ErrorNotice, Field, Loading, timestamp } from "../components";
import { nameList, turnSpeaker } from "../labels";
import { PlayButton, PlayerFailure, useTurnPlayer, type TurnPlayer } from "../player";

type State = OrganizerMeetingState;
type Reload = (() => Promise<void>) | undefined;

const WEEKDAYS =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|weekend|week|month|quarter|noon|midnight)s?\b/i;
// Case-sensitive, so "may" and "march" as ordinary words don't count.
const MONTHS =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/;
const NUMBER_WORDS =
  /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|percent|half|dozen)\b/i;

/**
 * What a turn mentions that transcription often gets wrong: a date, one of the participants'
 * names or a number. Review starts with these turns, since a mistake there changes the facts.
 */
export function checkReasons(
  text: string,
  people: readonly Pick<Participant, "displayName">[],
): ("date" | "name" | "number")[] {
  const reasons: ("date" | "name" | "number")[] = [];
  if (WEEKDAYS.test(text) || MONTHS.test(text)) reasons.push("date");
  const words = new Set(text.toLowerCase().match(/[\p{L}'-]+/gu) ?? []);
  const named = people.some((p) =>
    p.displayName
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part.length > 1 && words.has(part)),
  );
  if (named) reasons.push("name");
  if (/\d/.test(text) || NUMBER_WORDS.test(text)) reasons.push("number");
  return reasons;
}

const UNKNOWN = "unknown";

export function ReviewView({ state, onChange }: { state: State; onChange?: Reload }) {
  const id = state.meeting.id;
  const player = useTurnPlayer(id);
  const [editing, setEditing] = useState<string | null>(null);
  // The turn whose editor just closed; its Edit button takes focus back after the render.
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    if (editing !== null || returnFocus.current === null) return;
    document.getElementById(`edit-${returnFocus.current}`)?.focus();
    returnFocus.current = null;
  }, [editing]);

  function close(segmentId: string) {
    returnFocus.current = segmentId;
    setEditing(null);
  }

  const flagged = state.segments.filter(
    (s) => checkReasons(s.text, state.participants).length > 0,
  ).length;

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Transcript review</h2>
      <p>
        Fix misheard words and speakers before questions are drafted. Edits are logged and marked in
        the record.{" "}
        <Link href={`/m/${encodeURIComponent(id)}?stage=speakers`}>Change who each voice is</Link>.
      </p>
      {flagged > 0 && (
        <p>
          {flagged === 1 ? "1 turn mentions" : `${flagged} turns mention`} a date, name or number.
          They are outlined: check those first.
        </p>
      )}
      {player.element}
      <PlayerFailure player={player} />
      <ol className="turns">
        {state.segments.map((s) => (
          <Turn
            key={s.id}
            state={state}
            segment={s}
            player={state.audio === null ? null : player}
            editing={editing === s.id}
            onEdit={() => setEditing(s.id)}
            onClose={() => close(s.id)}
            onChange={onChange}
          />
        ))}
      </ol>
      <FinishReview state={state} onChange={onChange} />
    </section>
  );
}

function Turn({
  state,
  segment: s,
  player,
  editing,
  onEdit,
  onClose,
  onChange,
}: {
  state: State;
  segment: Segment;
  player: TurnPlayer | null;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onChange: Reload;
}) {
  const reasons = checkReasons(s.text, state.participants);
  const edits = state.edits.filter((e) => e.segmentId === s.id);
  return (
    <li className={reasons.length > 0 ? "turn turn-check" : "turn"}>
      <p className="turn-speaker">
        {turnSpeaker(s, state.participants, state.speakers)}
        {s.startMs !== null && <> at {timestamp(s.startMs)}</>}
        {s.edited && <span className="turn-edited">Edited</span>}
      </p>
      {editing ? (
        <TurnEditor state={state} segment={s} onClose={onClose} onChange={onChange} />
      ) : (
        <>
          <p className="turn-text">{s.text}</p>
          {reasons.length > 0 && <p className="turn-note">Check the {nameList(reasons)}.</p>}
          <div className="turn-actions">
            <Button variant="secondary" id={`edit-${s.id}`} onClick={onEdit}>
              Edit turn
            </Button>
            {player && <PlayButton player={player} turn={s} />}
          </div>
        </>
      )}
      {edits.length > 0 && <EditLog edits={edits} state={state} />}
    </li>
  );
}

function personName(id: string | null, people: State["participants"]): string {
  return people.find((p) => p.id === id)?.displayName ?? "Unknown speaker";
}

/** Every change to the turn, with what it was and what it became. */
function EditLog({ edits, state }: { edits: SegmentEdit[]; state: State }) {
  return (
    <details className="turn-log">
      <summary>{edits.length === 1 ? "1 change" : `${edits.length} changes`}</summary>
      <ol>
        {edits.map((e) =>
          e.field === "text" ? (
            <li key={e.id}>
              Words changed from “{e.before}” to “{e.after}”
            </li>
          ) : (
            <li key={e.id}>
              Speaker changed from {personName(e.before, state.participants)} to{" "}
              {personName(e.after, state.participants)}
            </li>
          ),
        )}
      </ol>
    </details>
  );
}

function TurnEditor({
  state,
  segment: s,
  onClose,
  onChange,
}: {
  state: State;
  segment: Segment;
  onClose: () => void;
  onChange: Reload;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const textId = `turn-text-${s.id}`;
  const speakerId = `turn-speaker-${s.id}`;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const words = String(form.get("text") ?? "").trim();
    const chosen = String(form.get("speaker") ?? UNKNOWN);
    const participantId = chosen === UNKNOWN ? null : chosen;
    if (words === "") {
      setError("Type what was said, or cancel to keep the old wording.");
      text.current?.focus();
      return;
    }
    const body: EditSegmentRequest = {};
    if (words !== s.text) body.text = words;
    if (participantId !== s.participantId) body.participantId = participantId;
    if (body.text === undefined && body.participantId === undefined) return onClose();
    setSaving(true);
    setFailure(null);
    const res = await organizerCall(state.meeting.id)<EditSegmentResponse>(
      `/api/segments/${encodeURIComponent(s.id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    setSaving(false);
    if (!res.ok) return setFailure(res.message);
    await onChange?.();
    onClose();
  }

  return (
    <form className="turn-editor" onSubmit={save} noValidate>
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <Field id={textId} label="What was said" error={error}>
        {(d) => (
          <textarea
            ref={text}
            id={textId}
            name="text"
            rows={3}
            defaultValue={s.text}
            aria-describedby={d}
            aria-invalid={error ? true : undefined}
            autoFocus
          />
        )}
      </Field>
      <Field id={speakerId} label="Who said it">
        {(d) => (
          <select
            id={speakerId}
            name="speaker"
            defaultValue={s.participantId ?? UNKNOWN}
            aria-describedby={d}
          >
            {state.participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
            <option value={UNKNOWN}>Unknown</option>
          </select>
        )}
      </Field>
      <div className="turn-actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving" : "Save turn"}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Deletes the recording unless the organizer keeps it, then drafts questions; the workspace
 * then moves to Questions.
 */
function FinishReview({ state, onChange }: { state: State; onChange: Reload }) {
  const id = state.meeting.id;
  const [keep, setKeep] = useState(state.audio?.retain ?? false);
  const [running, setRunning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const call = organizerCall(id);
  const base = `/api/meetings/${encodeURIComponent(id)}`;

  async function finish() {
    setFailure(null);
    setRunning(keep || state.audio === null ? "Finishing review." : "Deleting the recording.");
    const review = await call<FinishReviewResponse>(`${base}/review`, {
      method: "POST",
      body: JSON.stringify({ keepAudio: keep }),
    });
    if (!review.ok) {
      setRunning(null);
      return setFailure(review.message);
    }
    setRunning("Reading the transcript and drafting questions.");
    const res = await call<AnalyzeResponse>(`${base}/analyze`, { method: "POST" });
    setRunning(null);
    if (!res.ok) setFailure(res.message);
    await onChange?.();
  }

  if (running) return <Loading>{running}</Loading>;
  return (
    <div className="finish-review">
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      {state.audio !== null && (
        <Field
          id="keep-audio"
          check
          label="Keep the recording so quotes in the record can be played back"
          hint={keep ? undefined : "The audio file will be deleted now."}
        >
          {(d) => (
            <input
              id="keep-audio"
              type="checkbox"
              checked={keep}
              onChange={(e) => setKeep(e.currentTarget.checked)}
              aria-describedby={d}
            />
          )}
        </Field>
      )}
      <Button onClick={finish}>Finish review</Button>
    </div>
  );
}
