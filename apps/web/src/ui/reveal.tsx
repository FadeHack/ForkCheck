"use client";

import { useState } from "react";
import {
  validityLabel,
  type Answer,
  type Confirmation,
  type Participant,
  type Resolution,
  type SourceQuote,
  type Split,
  type ValidityLabel,
} from "@forkcheck/core";
import type { LabelValidityResponse, ParticipantProbe } from "../contracts/api";
import { callApi } from "./api";
import { ForkView, StatusLabel, type Status } from "./components";
import { nameList, validityText } from "./labels";
import { ResolvePanel, type Actor } from "./resolve";

export interface RevealItem {
  split: Split;
  probe: Pick<ParticipantProbe, "id" | "kind" | "splitId" | "stem" | "options">;
  quote: SourceQuote | null;
  answers: Answer[];
  resolutions: Resolution[];
  confirmations: Confirmation[];
}

export const VALIDITY_PROMPT = "Is this a real difference?";
export const VALIDITY_SUMMARY = "Not a real difference? Say why";
const LABELS_LOCKED = "Someone has proposed wording, so labels on this question can't change now.";

/** What a recheck's answers mean for the wording it followed up. */
export const recheckOutcome: Record<Split["outcome"], { status: Status; text: string }> = {
  consistent: { status: "rechecked", text: ": everyone gave the same answer." },
  split: { status: "reopened", text: ": answers differed, so the wording didn't settle it." },
  insufficient: { status: "not_conclusive", text: ": not enough answers." },
};

function RecheckResult({ item, people }: { item: RevealItem; people: Participant[] }) {
  const { status, text } = recheckOutcome[item.split.outcome];
  return (
    <div className="recheck-result">
      <h4>Recheck</h4>
      <p>
        <StatusLabel status={status} />
        {text}
      </p>
      <ForkView
        stem={item.probe.stem}
        options={item.probe.options}
        split={item.split}
        answers={item.answers}
        people={people}
      />
    </div>
  );
}

/** Differences first, since they are what the group came to discuss; rank order otherwise. */
export function revealOrder<T extends RevealItem>(items: T[]): T[] {
  return [
    ...items.filter((i) => i.split.outcome === "split"),
    ...items.filter((i) => i.split.outcome !== "split"),
  ];
}

/** Each label someone chose, with who chose it, in the order the labels are offered. */
export function validityTally(split: Split, people: Participant[]): string[] {
  const name = new Map(people.map((p) => [p.id, p.displayName]));
  return validityLabel.options.flatMap((label) => {
    const who = split.validity
      .filter((v) => v.label === label)
      .map((v) => name.get(v.participantId) ?? "Someone");
    return who.length === 0 ? [] : [`${validityText[label]}: ${nameList(who)}`];
  });
}

function ValidityControl({
  split,
  token,
  viewerId,
  onChange,
}: {
  split: Split;
  token: string;
  viewerId: string;
  onChange?: (() => Promise<void>) | undefined;
}) {
  const own = split.validity.find((v) => v.participantId === viewerId)?.label ?? null;
  const [chosen, setChosen] = useState<ValidityLabel | null>(own);
  const [note, setNote] = useState("");
  const locked = split.status !== "open";
  const hintId = `${split.id}-validity-hint`;

  async function choose(label: ValidityLabel) {
    setChosen(label);
    setNote("");
    const res = await callApi<LabelValidityResponse>(
      `/api/p/${encodeURIComponent(token)}/validity`,
      { method: "POST", body: JSON.stringify({ splitId: split.id, label }) },
    );
    if (!res.ok) {
      setChosen(own);
      setNote(res.message);
      return;
    }
    setNote("Saved.");
    await onChange?.();
  }

  // Most people only need to propose wording, so the labels wait behind one line until wanted.
  return (
    <details className="validity-more" open={own !== null || undefined}>
      <summary>{VALIDITY_SUMMARY}</summary>
      <fieldset className="validity" aria-describedby={locked ? hintId : undefined}>
        <legend>{VALIDITY_PROMPT}</legend>
        {validityLabel.options.map((label) => (
          <label key={label} className="choice">
            <input
              type="radio"
              name={`${split.id}-validity`}
              value={label}
              checked={chosen === label}
              disabled={locked}
              onChange={() => void choose(label)}
            />
            <span>{validityText[label]}</span>
          </label>
        ))}
        {locked && (
          <p id={hintId} className="field-hint">
            {LABELS_LOCKED}
          </p>
        )}
        <p role="status" className="field-hint">
          {note}
        </p>
      </fieldset>
    </details>
  );
}

/**
 * Every revealed question as the same fork for every viewer, and under each difference its
 * labels and wording. A participant also gets the controls; the organizer sees the same page
 * without them.
 */
export function RevealList({
  items,
  people,
  actor,
}: {
  items: RevealItem[];
  people: Participant[];
  actor?: Actor | undefined;
}) {
  const questions = items.filter((i) => i.probe.kind === "diagnostic");
  if (questions.length === 0) return <p>No answers have been revealed yet.</p>;
  return (
    <section aria-labelledby="reveal-heading" className="reveal">
      <h2 id="reveal-heading">Revealed answers</h2>
      {revealOrder(questions).map(
        ({ split, probe, quote, answers, resolutions, confirmations }) => {
          const tally = validityTally(split, people);
          const rechecks = items.filter((i) => i.probe.splitId === split.id);
          return (
            <div key={split.id} className="reveal-item">
              <ForkView
                quote={quote}
                stem={probe.stem}
                options={probe.options}
                split={split}
                answers={answers}
                people={people}
              />
              {split.outcome === "split" && (
                <>
                  <p>
                    <StatusLabel status={split.status} />
                  </p>
                  {actor && (
                    <ValidityControl
                      split={split}
                      token={actor.token}
                      viewerId={actor.viewerId}
                      onChange={actor.onChange}
                    />
                  )}
                  {tally.length > 0 && (
                    <>
                      <h4>Labels so far</h4>
                      <ul>
                        {tally.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {rechecks.map((r) => (
                    <RecheckResult key={r.split.id} item={r} people={people} />
                  ))}
                  <ResolvePanel
                    split={split}
                    resolutions={resolutions}
                    confirmations={confirmations}
                    people={people}
                    actor={actor}
                  />
                </>
              )}
            </div>
          );
        },
      )}
    </section>
  );
}
