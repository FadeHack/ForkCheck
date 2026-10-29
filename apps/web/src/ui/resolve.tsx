"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { Confirmation, Participant, Resolution, Split } from "@forkcheck/core";
import type {
  ConfirmResolutionResponse,
  DraftResolutionResponse,
  MarkUnresolvedResponse,
  ProposeResolutionResponse,
} from "../contracts/api";
import { callApi } from "./api";
import { Button, ErrorNotice, Field, Glyph } from "./components";

export const MODEL_DRAFT_LABEL = "Drafted by the model. Edit it or write your own.";
export const WORDING_HINT = "Write what you agree happens, in words nobody could read two ways.";
export const UNRESOLVED_CONFIRM =
  "Record this difference as unresolved? Both readings go into the record as not agreed, and nobody can propose wording for it after this.";
export const UNRESOLVED_NOTE =
  "Recorded as unresolved: the group agreed to disagree. Both readings go into the record as not agreed.";
export const REOPENED_NOTE =
  "Everyone confirmed this wording, but the recheck answers differed. Propose clearer wording, or agree to disagree.";
const ABSENT_VIEWER = "The organizer marked you absent, so you can't propose or confirm wording.";
const EMPTY_WORDING = "Write the wording first, or use the model's draft.";

/** The proposal everyone is confirming now: the latest one that hasn't been replaced. */
export function currentProposal(resolutions: Resolution[]): Resolution | undefined {
  return resolutions.filter((r) => r.status !== "superseded").at(-1);
}

export interface ConfirmLine {
  participant: Participant;
  state: "confirmed" | "not_yet" | "absent";
}

/** Everyone in the meeting against one proposal; absent people are listed, not waited for. */
export function confirmLines(
  proposal: Resolution,
  confirmations: Confirmation[],
  people: Participant[],
): ConfirmLine[] {
  const confirmed = new Set(
    confirmations.filter((c) => c.resolutionId === proposal.id).map((c) => c.participantId),
  );
  return people.map((participant) => ({
    participant,
    state:
      participant.status === "absent"
        ? "absent"
        : confirmed.has(participant.id)
          ? "confirmed"
          : "not_yet",
  }));
}

const lineText: Record<ConfirmLine["state"], string> = {
  confirmed: "Confirmed",
  not_yet: "Not yet",
  absent: "Absent, not asked",
};

export function ConfirmList({ lines }: { lines: ConfirmLine[] }) {
  return (
    <ul className="people-list confirm-list">
      {lines.map(({ participant: p, state }) => (
        <li key={p.id}>
          <span>{p.displayName}</span>
          <span className={`person-status confirm-${state}`}>
            {state === "confirmed" && <Glyph name="check" />}
            {lineText[state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function proposedByText(proposal: Resolution, people: Participant[]): string {
  const name = people.find((p) => p.id === proposal.proposedBy)?.displayName ?? "a participant";
  return proposal.draftedByModel
    ? `Drafted by the model, then submitted by ${name}`
    : `Proposed by ${name}`;
}

export interface Actor {
  token: string;
  viewerId: string;
  onChange?: (() => Promise<void>) | undefined;
}

const path = (token: string, rest: string) => `/api/p/${encodeURIComponent(token)}/${rest}`;

/**
 * The participant's own wording. A model draft only ever fills the field when the participant
 * presses "Use this draft"; what is sent is whatever the field holds when they press "Propose".
 */
function ProposalForm({
  split,
  actor,
  onEdit,
  onDone,
  onCancel,
}: {
  split: Split;
  actor: Actor;
  /** Called on the first change, so a refresh that brings someone else's proposal keeps this form. */
  onEdit: () => void;
  /** Called once the proposal is saved. */
  onDone: () => void;
  onCancel?: (() => void) | undefined;
}) {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [usedDraft, setUsedDraft] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState("");

  async function askForDraft() {
    setDrafting(true);
    setFailure("");
    const res = await callApi<DraftResolutionResponse>(
      `${path(actor.token, "resolutions")}?draft=1`,
      {
        method: "POST",
        body: JSON.stringify({ splitId: split.id }),
      },
    );
    setDrafting(false);
    if (res.ok) setDraft(res.data.text);
    else setFailure(res.message);
  }

  function useDraft() {
    setText(draft ?? "");
    setUsedDraft(true);
    onEdit();
    field.current?.focus();
  }

  async function propose(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "") {
      setError(EMPTY_WORDING);
      field.current?.focus();
      return;
    }
    setError(undefined);
    setFailure("");
    setSending(true);
    const res = await callApi<ProposeResolutionResponse>(path(actor.token, "resolutions"), {
      method: "POST",
      body: JSON.stringify({ splitId: split.id, text, ...(usedDraft && { draftedByModel: true }) }),
    });
    setSending(false);
    if (!res.ok) {
      setFailure(res.message);
      return;
    }
    setText("");
    setDraft(null);
    setUsedDraft(false);
    await actor.onChange?.();
    onDone();
  }

  return (
    <form className="proposal-form" onSubmit={(e) => void propose(e)} noValidate>
      <Field id={fieldId} label="Your wording" hint={WORDING_HINT} error={error}>
        {(describedBy) => (
          <textarea
            ref={field}
            id={fieldId}
            rows={3}
            value={text}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              onEdit();
              if (e.target.value.trim() === "") setUsedDraft(false);
            }}
          />
        )}
      </Field>
      {draft !== null && (
        <div className="model-draft">
          <p className="model-draft-label">{MODEL_DRAFT_LABEL}</p>
          <blockquote>
            <p>{draft}</p>
          </blockquote>
          <Button variant="secondary" onClick={useDraft}>
            Use this draft
          </Button>
        </div>
      )}
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      <div className="actions">
        <Button type="submit" disabled={sending}>
          {sending ? "Proposing" : "Propose wording"}
        </Button>
        <Button variant="secondary" disabled={drafting} onClick={() => void askForDraft()}>
          {drafting ? "Drafting" : "Draft wording for me"}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Agreeing on wording for one difference. Everyone sees the same proposal and who has
 * confirmed it; a participant also gets the actions, the organizer only watches.
 */
export function ResolvePanel({
  split,
  resolutions,
  confirmations,
  people,
  actor,
}: {
  split: Split;
  resolutions: Resolution[];
  confirmations: Confirmation[];
  people: Participant[];
  actor?: Actor | undefined;
}) {
  const proposal = currentProposal(resolutions);
  const [changing, setChanging] = useState(false);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmId = useId();
  const viewer = people.find((p) => p.id === actor?.viewerId);
  const canAct = actor !== undefined && viewer?.status === "active";
  const open = ["open", "resolving", "reopened"].includes(split.status);

  async function act<T>(rest: string) {
    if (!actor) return;
    setBusy(true);
    setFailure("");
    const res = await callApi<T>(path(actor.token, rest), { method: "POST" });
    setBusy(false);
    if (!res.ok) setFailure(res.message);
    await actor.onChange?.();
  }

  const lines = proposal ? confirmLines(proposal, confirmations, people) : [];
  const viewerConfirmed = lines.some(
    (l) => l.participant.id === actor?.viewerId && l.state === "confirmed",
  );

  return (
    <div className="resolve">
      <h4>Wording</h4>
      {split.status === "unresolved" && <p>{UNRESOLVED_NOTE}</p>}
      {proposal && split.status !== "unresolved" && (
        <>
          <figure className="quote proposal">
            <blockquote>
              <p>{proposal.text}</p>
            </blockquote>
            <figcaption>{proposedByText(proposal, people)}</figcaption>
          </figure>
          <ConfirmList lines={lines} />
          {split.status === "reopened" && <p>{REOPENED_NOTE}</p>}
        </>
      )}
      {!proposal && open && !canAct && <p>Nobody has proposed wording yet.</p>}
      {actor && viewer?.status === "absent" && open && <p>{ABSENT_VIEWER}</p>}
      {failure && <ErrorNotice>{failure}</ErrorNotice>}
      {canAct && open && (!proposal || changing) && (
        <ProposalForm
          split={split}
          actor={actor}
          onEdit={() => setChanging(true)}
          onDone={() => setChanging(false)}
          onCancel={proposal ? () => setChanging(false) : undefined}
        />
      )}
      {canAct && open && (
        <div className="actions">
          {proposal && !changing && !viewerConfirmed && (
            <Button
              disabled={busy}
              onClick={() =>
                void act<ConfirmResolutionResponse>(
                  `resolutions/${encodeURIComponent(proposal.id)}/confirm`,
                )
              }
            >
              Confirm this wording
            </Button>
          )}
          {proposal && !changing && (
            <Button variant="secondary" onClick={() => setChanging(true)}>
              Propose a change
            </Button>
          )}
          <Button variant="secondary" onClick={() => dialog.current?.showModal()}>
            Agree to disagree
          </Button>
        </div>
      )}
      {canAct && open && (
        <dialog ref={dialog} className="dialog" aria-labelledby={confirmId}>
          <p id={confirmId}>{UNRESOLVED_CONFIRM}</p>
          <div className="actions">
            <Button
              onClick={() => {
                dialog.current?.close();
                void act<MarkUnresolvedResponse>(
                  `splits/${encodeURIComponent(split.id)}/unresolved`,
                );
              }}
            >
              Record as unresolved
            </Button>
            <Button variant="secondary" onClick={() => dialog.current?.close()}>
              Keep working on it
            </Button>
          </div>
        </dialog>
      )}
    </div>
  );
}
