"use client";

import { PROBE_BUDGET, type Probe } from "@forkcheck/core";
import { useEffect, useState, type FormEvent } from "react";
import type {
  AnalyzeResponse,
  EditProbeResponse,
  MeetingProgressResponse,
  OpenRoundResponse,
  OrganizerMeetingState,
} from "../../contracts/api";
import { organizerCall } from "../api";
import { Button, ErrorNotice, Field, Loading, QuoteBlock, Toast } from "../components";
import { decisionStatusLabel, dimensionLabel, lintNote, tierLabel } from "../labels";
import { useToast } from "../use-toast";

type State = OrganizerMeetingState;

const DRAFTING = "Reading the transcript and drafting questions.";
const POLL_MS = 3000;

/** Drafts that pass every check, in rank order, up to one round's worth. */
export function initialSelection(drafts: readonly Probe[]): string[] {
  return drafts
    .filter((p) => p.lint.length === 0)
    .slice(0, PROBE_BUDGET)
    .map((p) => p.id);
}

export function publishLabel(n: number): string {
  return `Publish ${n} ${n === 1 ? "question" : "questions"}`;
}

/** Starts analysis, or resumes it from the step that failed; the server picks the step. */
function DraftQuestions({ state, onChange }: { state: State; onChange: () => Promise<void> }) {
  const { meeting } = state;
  const call = organizerCall(meeting.id);
  const [running, setRunning] = useState(meeting.status === "analyzing");
  const [stalled, setStalled] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A run started elsewhere (another tab, or before a reload): follow it until it ends.
  useEffect(() => {
    if (meeting.status !== "analyzing") return;
    const call = organizerCall(meeting.id);
    const timer = setInterval(async () => {
      const res = await call<MeetingProgressResponse>(
        `/api/meetings/${encodeURIComponent(meeting.id)}/progress`,
      );
      if (!res.ok) return;
      setStalled(res.data.stalled);
      if (res.data.status !== "analyzing") await onChange();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [meeting.id, meeting.status, onChange]);

  async function start() {
    setRunning(true);
    setFailure(null);
    const res = await call<AnalyzeResponse>(
      `/api/meetings/${encodeURIComponent(meeting.id)}/analyze`,
      { method: "POST" },
    );
    if (!res.ok) setFailure(res.message);
    await onChange();
    setRunning(false);
  }

  if (meeting.status === "analyzing" && stalled) {
    return (
      <>
        <ErrorNotice>
          Drafting has stopped making progress. Retry to pick it up from the last finished step.
        </ErrorNotice>
        <Button onClick={start}>Retry drafting</Button>
      </>
    );
  }
  if (running || meeting.status === "analyzing") return <Loading>{DRAFTING}</Loading>;
  if (meeting.status === "failed" || failure !== null) {
    return (
      <>
        <ErrorNotice>
          {failure ?? meeting.error ?? "Drafting questions failed. Retry from that step."}
        </ErrorNotice>
        <Button onClick={start}>Retry from that step</Button>
      </>
    );
  }
  return (
    <>
      <p>
        Questions haven&apos;t been drafted for this transcript yet. ForkCheck reads the transcript,
        finds the decisions, and drafts a question for each detail people may have understood
        differently.
      </p>
      <Button onClick={start}>Draft questions</Button>
    </>
  );
}

function Decisions({ state }: { state: State }) {
  const names = new Map(state.participants.map((p) => [p.id, p.displayName]));
  const segments = new Map(state.segments.map((s) => [s.id, s]));
  return (
    <section aria-labelledby="decisions-heading">
      <h2 id="decisions-heading">Decisions found</h2>
      <ol className="decision-list">
        {state.decisions.map(({ decision, evidence }) => (
          <li key={decision.id}>
            <p className="decision-statement">{decision.statement}</p>
            <p className="decision-status">{decisionStatusLabel[decision.status]}</p>
            {evidence.map((e) => {
              const segment = segments.get(e.segmentId);
              const speaker = segment?.participantId
                ? (names.get(segment.participantId) ?? null)
                : null;
              return <QuoteBlock key={e.id} quote={e.quote} segment={segment} speaker={speaker} />;
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProbeEditor({
  probe,
  onSave,
  onCancel,
}: {
  probe: Probe;
  onSave: (stem: string, options: string[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stemId = `${probe.id}-stem`;
  const optionsId = `${probe.id}-options`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stem = String(form.get("stem") ?? "").trim();
    const options = String(form.get("options") ?? "")
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    if (stem === "") {
      setError("Enter the question.");
      return;
    }
    setSaving(true);
    setError(await onSave(stem, options));
    setSaving(false);
  }

  return (
    <form onSubmit={submit} noValidate className="probe-editor">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field id={stemId} label="Question">
        {(d) => <input id={stemId} name="stem" defaultValue={probe.stem} aria-describedby={d} />}
      </Field>
      <Field
        id={optionsId}
        label="Options, one per line"
        hint="Use 2 to 4 options. Everyone also gets “Not sure” and can write their own answer."
      >
        {(d) => (
          <textarea
            id={optionsId}
            name="options"
            rows={4}
            defaultValue={probe.options.map((o) => o.text).join("\n")}
            aria-describedby={d}
          />
        )}
      </Field>
      <div className="actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving and checking" : "Save and check"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Checks({ probe }: { probe: Probe }) {
  if (probe.lint.length === 0) return <p className="checks-pass">Passes every check.</p>;
  return (
    <div className="checks-fail">
      <p>
        <strong>Can&apos;t be sent until this is fixed:</strong>
      </p>
      <ul>
        {probe.lint.map((f, i) => (
          <li key={`${f.rule}-${i}`}>{lintNote(f)}</li>
        ))}
      </ul>
    </div>
  );
}

function DraftCard({
  probe,
  state,
  selected,
  full,
  onSelect,
  onEdit,
  onWithdraw,
}: {
  probe: Probe;
  state: State;
  selected: boolean;
  full: boolean;
  onSelect: (on: boolean) => void;
  onEdit: (stem: string, options: string[]) => Promise<string | null>;
  onWithdraw: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const candidate = state.candidates.find((c) => c.id === probe.candidateId);
  const target = state.decisions.find((d) => d.decision.id === candidate?.decisionId);
  const names = new Map(state.participants.map((p) => [p.id, p.displayName]));
  const quote = target?.evidence[0];
  const segment = state.segments.find((s) => s.id === quote?.segmentId);
  const failing = probe.lint.length > 0;
  const selectId = `${probe.id}-send`;
  const why = failing
    ? "Fix the failing check to send this question."
    : full && !selected
      ? `A round can have up to ${PROBE_BUDGET} questions. Clear another one to send this.`
      : undefined;

  return (
    <li className="draft">
      {editing ? (
        <ProbeEditor
          probe={probe}
          onCancel={() => setEditing(false)}
          onSave={async (stem, options) => {
            const error = await onEdit(stem, options);
            if (error === null) setEditing(false);
            return error;
          }}
        />
      ) : (
        <>
          <h3>{probe.stem}</h3>
          <ul className="draft-options">
            {probe.options.map((o) => (
              <li key={o.id}>{o.text}</li>
            ))}
          </ul>
        </>
      )}
      <dl className="draft-facts">
        {target && (
          <>
            <dt>Decision</dt>
            <dd>{target.decision.statement}</dd>
          </>
        )}
        {candidate && (
          <>
            <dt>Detail</dt>
            <dd>{dimensionLabel[candidate.dimension]}</dd>
          </>
        )}
        <dt>Written as</dt>
        <dd>{tierLabel[probe.tier]}</dd>
      </dl>
      {quote && (
        <QuoteBlock
          quote={quote.quote}
          segment={segment}
          speaker={segment?.participantId ? (names.get(segment.participantId) ?? null) : null}
        />
      )}
      <Checks probe={probe} />
      {!editing && (
        <div className="draft-actions">
          <Field id={selectId} check label="Send this question" hint={why}>
            {(d) => (
              <input
                id={selectId}
                type="checkbox"
                checked={selected}
                disabled={why !== undefined}
                onChange={(e) => onSelect(e.target.checked)}
                aria-describedby={d}
              />
            )}
          </Field>
          <div className="actions">
            <Button
              variant="secondary"
              aria-label={`Edit "${probe.stem}"`}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              variant="secondary"
              aria-label={`Withdraw "${probe.stem}"`}
              onClick={onWithdraw}
            >
              Withdraw
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function QuestionsView({
  state,
  onChange = async () => {},
}: {
  state: State;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const { meeting } = state;
  const call = organizerCall(meeting.id);
  const diagnostic = state.probes.filter((p) => p.kind === "diagnostic");
  const drafts = diagnostic.filter((p) => p.status === "draft");
  const withdrawn = diagnostic.filter((p) => p.status === "withdrawn");
  const [chosen, setChosen] = useState<string[]>(() => initialSelection(drafts));
  const [failure, setFailure] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [toast, showToast] = useToast();

  if (meeting.status === "draft" || meeting.status === "analyzing" || meeting.status === "failed") {
    return <DraftQuestions state={state} onChange={onChange} />;
  }
  if (state.decisions.length === 0) {
    return <p>No decisions with open details were found in this transcript.</p>;
  }
  if (state.rounds.some((r) => r.kind === "diagnostic")) {
    return (
      <>
        <Decisions state={state} />
        <section aria-labelledby="sent-heading">
          <h2 id="sent-heading">Questions sent</h2>
          <ol>
            {diagnostic
              .filter((p) => p.status === "published")
              .map((p) => (
                <li key={p.id}>{p.stem}</li>
              ))}
          </ol>
        </section>
      </>
    );
  }

  // A draft that fails its checks after an edit drops out of the selection on its own.
  const sendable = new Set(drafts.filter((p) => p.lint.length === 0).map((p) => p.id));
  const selected = chosen.filter((id) => sendable.has(id));
  const full = selected.length >= PROBE_BUDGET;

  async function edit(probe: Probe, body: object): Promise<EditProbeResponse | string> {
    const res = await call<EditProbeResponse>(`/api/probes/${encodeURIComponent(probe.id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await onChange();
    return res.ok ? res.data : res.message;
  }

  async function publish() {
    setPublishing(true);
    setFailure(null);
    // Rank order, not click order, so participants see the most important question first.
    const probeIds = drafts.map((p) => p.id).filter((id) => selected.includes(id));
    const res = await call<OpenRoundResponse>(
      `/api/meetings/${encodeURIComponent(meeting.id)}/rounds`,
      { method: "POST", body: JSON.stringify({ probeIds }) },
    );
    if (!res.ok) setFailure(res.message);
    await onChange();
    setPublishing(false);
  }

  return (
    <>
      <Decisions state={state} />
      <section aria-labelledby="drafts-heading">
        <h2 id="drafts-heading">Draft questions</h2>
        {drafts.length === 0 ? (
          <p>No draft questions are left. Restore a withdrawn one to send it.</p>
        ) : (
          <>
            <p>
              Most important first. Choose up to {PROBE_BUDGET} to send. Each participant answers
              privately, and nobody sees other answers until you reveal them.
            </p>
            <ol className="draft-list">
              {drafts.map((p) => (
                <DraftCard
                  key={p.id}
                  probe={p}
                  state={state}
                  selected={selected.includes(p.id)}
                  full={full}
                  onSelect={(on) =>
                    setChosen((c) => (on ? [...c, p.id] : c.filter((id) => id !== p.id)))
                  }
                  onEdit={async (stem, options) => {
                    const out = await edit(p, { stem, options });
                    if (typeof out === "string") return out;
                    showToast(
                      out.lint.length === 0
                        ? "Saved. It passes every check."
                        : `Saved. It fails ${out.lint.length === 1 ? "a check" : `${out.lint.length} checks`}.`,
                    );
                    return null;
                  }}
                  onWithdraw={async () => {
                    const out = await edit(p, { withdrawn: true });
                    showToast(typeof out === "string" ? out : "Question withdrawn");
                  }}
                />
              ))}
            </ol>
          </>
        )}
        {failure && <ErrorNotice>{failure}</ErrorNotice>}
        <div className="publish">
          <Button
            onClick={publish}
            disabled={selected.length === 0 || publishing}
            aria-describedby={selected.length === 0 ? "publish-why" : undefined}
          >
            {publishing ? "Publishing" : publishLabel(selected.length)}
          </Button>
          {selected.length === 0 && (
            <p id="publish-why" className="field-hint">
              Choose at least one question that passes every check.
            </p>
          )}
        </div>
      </section>
      {withdrawn.length > 0 && (
        <section aria-labelledby="withdrawn-heading">
          <h2 id="withdrawn-heading">Withdrawn</h2>
          <ul className="withdrawn-list">
            {withdrawn.map((p) => (
              <li key={p.id}>
                <span>{p.stem}</span>
                <Button
                  variant="secondary"
                  aria-label={`Restore "${p.stem}"`}
                  onClick={async () => {
                    const out = await edit(p, { withdrawn: false });
                    showToast(typeof out === "string" ? out : "Question restored");
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Toast message={toast} />
    </>
  );
}
