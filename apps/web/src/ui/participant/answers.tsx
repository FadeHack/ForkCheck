"use client";

import { useState, type FormEvent } from "react";
import type { Answer } from "@forkcheck/core";
import type { ParticipantProbe, SubmitAnswerRequest } from "../../contracts/api";
import { callApi } from "../api";
import { Button, ErrorNotice } from "../components";
import { markedStem } from "../proof";

/** One question's answer while it is being chosen. */
export interface AnswerDraft {
  choice: Answer["choice"] | null;
  optionId: string | null;
  writeIn: string;
}

export const UNSURE = "Not sure";
export const WRITE_IN_NOTE =
  "The model will match this to the closest option, and that match will be shown.";
const NOT_SAVED = "Your answer wasn't saved. Check your connection and send again.";
const FIX = {
  choose: "Choose an answer. If you don't know, choose Not sure.",
  writeIn: "Write your answer, or choose one of the options.",
};

const empty: AnswerDraft = { choice: null, optionId: null, writeIn: "" };

/** Starts each open question from the participant's saved answer, if they sent one. */
export function initialDrafts(
  probes: ParticipantProbe[],
  ownAnswers: Answer[],
): Record<string, AnswerDraft> {
  const saved = new Map(ownAnswers.map((a) => [a.probeId, a]));
  return Object.fromEntries(
    probes.map((p) => {
      const a = saved.get(p.id);
      return [
        p.id,
        a ? { choice: a.choice, optionId: a.optionId, writeIn: a.writeInText ?? "" } : empty,
      ];
    }),
  );
}

/** One request per question, in order, or a message for each question still missing an answer. */
export function answerRequests(
  probes: ParticipantProbe[],
  drafts: Record<string, AnswerDraft>,
): { ok: true; bodies: SubmitAnswerRequest[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const bodies: SubmitAnswerRequest[] = [];
  for (const p of probes) {
    const d = drafts[p.id] ?? empty;
    if (d.choice === "option" && d.optionId !== null) {
      bodies.push({ probeId: p.id, choice: "option", optionId: d.optionId });
    } else if (d.choice === "unsure") {
      bodies.push({ probeId: p.id, choice: "unsure" });
    } else if (d.choice === "write_in" && d.writeIn.trim() !== "") {
      bodies.push({ probeId: p.id, choice: "write_in", writeIn: d.writeIn.trim() });
    } else {
      errors[p.id] = d.choice === "write_in" ? FIX.writeIn : FIX.choose;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, bodies };
}

/** How the participant's own answer reads back to them. */
export function answerText(probe: ParticipantProbe, answer: Answer): string {
  if (answer.choice === "unsure") return UNSURE;
  if (answer.choice === "write_in") return `In your own words: "${answer.writeInText ?? ""}"`;
  return probe.options.find((o) => o.id === answer.optionId)?.text ?? "";
}

function ProbeCard({
  probe,
  index,
  total,
  draft,
  error,
  onChange,
}: {
  probe: ParticipantProbe;
  index: number;
  total: number;
  draft: AnswerDraft;
  error: string | undefined;
  onChange: (next: AnswerDraft) => void;
}) {
  const errorId = `${probe.id}-error`;
  const writeInId = `${probe.id}-write-in`;
  const choice = (value: string, label: string, next: AnswerDraft, checked: boolean) => (
    <label key={value} className="choice">
      <input
        type="radio"
        name={probe.id}
        value={value}
        checked={checked}
        onChange={() => onChange(next)}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <fieldset className="probe-card" aria-describedby={error ? errorId : undefined}>
      <legend>
        <span className="probe-count">
          <span className="visually-hidden">Question </span>
          <span className="probe-number">{index + 1}</span> of {total}
        </span>
        <span className="probe-stem">{markedStem(probe.stem)}</span>
      </legend>
      {probe.options.map((o) =>
        choice(
          o.id,
          o.text,
          { ...draft, choice: "option", optionId: o.id },
          draft.choice === "option" && draft.optionId === o.id,
        ),
      )}
      {choice(
        UNSURE,
        UNSURE,
        { ...draft, choice: "unsure", optionId: null },
        draft.choice === "unsure",
      )}
      {choice(
        "write_in",
        "Write my own answer",
        { ...draft, choice: "write_in", optionId: null },
        draft.choice === "write_in",
      )}
      {draft.choice === "write_in" && (
        <div className="field write-in">
          <label htmlFor={writeInId}>Your answer</label>
          <textarea
            id={writeInId}
            rows={3}
            value={draft.writeIn}
            aria-describedby={`${writeInId}-hint`}
            onChange={(e) => onChange({ ...draft, writeIn: e.target.value })}
          />
          <span id={`${writeInId}-hint`} className="field-hint">
            {WRITE_IN_NOTE}
          </span>
        </div>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Every open question at once, sent together with "Send my answers". */
export function AnswerForm({
  probes,
  ownAnswers,
  token,
  onSent,
}: {
  probes: ParticipantProbe[];
  ownAnswers: Answer[];
  token: string;
  onSent?: (() => Promise<void>) | undefined;
}) {
  const [drafts, setDrafts] = useState(() => initialDrafts(probes, ownAnswers));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = answerRequests(probes, drafts);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = probes.find((p) => checked.errors[p.id]);
      if (first) document.querySelector<HTMLInputElement>(`input[name="${first.id}"]`)?.focus();
      return;
    }
    setErrors({});
    setFailure("");
    setSending(true);
    for (const body of checked.bodies) {
      const res = await callApi(`/api/p/${encodeURIComponent(token)}/answers`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // A closed round or a withdrawn question has its own message; anything else is transport.
        setFailure(res.status === 409 ? res.message : NOT_SAVED);
        setSending(false);
        return;
      }
    }
    setSending(false);
    await onSent?.();
  }

  return (
    <form onSubmit={submit} noValidate>
      {probes.map((p, i) => (
        <ProbeCard
          key={p.id}
          probe={p}
          index={i}
          total={probes.length}
          draft={drafts[p.id] ?? empty}
          error={errors[p.id]}
          onChange={(next) => setDrafts((all) => ({ ...all, [p.id]: next }))}
        />
      ))}
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <Button type="submit" disabled={sending}>
        {sending ? "Sending" : "Send my answers"}
      </Button>
    </form>
  );
}
