"use client";

import { useEffect, useState } from "react";
import type { Participant, RecordItem, SourceRef } from "@forkcheck/core";
import type { RecordResponse, RecordSource, RevealedSplit } from "../../contracts/api";
import { callApi, MISSING_KEY, organizerToken, type Loaded } from "../api";
import {
  Banner,
  Button,
  ForkView,
  Loading,
  PageError,
  QuoteBlock,
  SourceLink,
  SpeakerChip,
  StatusLabel,
  timestamp,
  type Status,
} from "../components";
import { nameList } from "../labels";
import { ConfirmList, type ConfirmLine } from "../resolve";
import { SimulatedBanner } from "../simulated-banner";
import { formatHeldAt } from "../time";

const recheckText: Record<RecordItem["recheck"], [Status, string] | null> = {
  passed: ["rechecked", "everyone gave the same answer."],
  failed: ["reopened", "answers differed, so the wording didn't settle it."],
  not_conclusive: ["not_conclusive", "not enough answers."],
  not_run: null,
};

/** Ids here come from the database, so they are reduced to characters safe in a fragment. */
const anchor = (kind: "item" | "segment" | "question" | "confirmations", id: string) =>
  `${kind}-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

type SegmentRef = Extract<SourceRef, { kind: "segment" }>;

interface Context {
  people: Participant[];
  sources: ReadonlyMap<string, RecordSource>;
  questions: RevealedSplit[];
}

const nameOf = (id: string, people: Participant[]) =>
  people.find((p) => p.id === id)?.displayName ?? "A participant";

function speakerOf(segment: RecordSource | undefined, people: Participant[]): string | null {
  return people.find((p) => p.id === segment?.participantId)?.displayName ?? null;
}

/** "Priya at 04:12": who said it and when, for a link to the transcript. */
function saidBy(segment: RecordSource | undefined, people: Participant[]): string {
  const who = speakerOf(segment, people) ?? "Unknown speaker";
  return segment?.startMs != null ? `${who} at ${timestamp(segment.startMs)}` : who;
}

/** Everyone against the item's confirmations; absent people are named, not waited for. */
function confirmLines(item: RecordItem, people: Participant[]): ConfirmLine[] {
  return people.map((participant) => ({
    participant,
    state: item.absent.includes(participant.id)
      ? "absent"
      : item.confirmedBy.includes(participant.id)
        ? "confirmed"
        : "not_yet",
  }));
}

function Item({ item, ctx }: { item: RecordItem; ctx: Context }) {
  const refs = item.sourceRefs.filter((r): r is SegmentRef => r.kind === "segment");
  // Only segments the response carries get a link, so no link points at nothing.
  const quotes = refs.filter((r) => ctx.sources.has(r.segmentId));
  const source = ctx.sources.get(refs[0]?.segmentId ?? "");
  // The record's own ref knows the origin, so the transcription note never depends on the lookup.
  const statedSegment =
    source ??
    (refs[0] && {
      id: refs[0].segmentId,
      participantId: null,
      startMs: null,
      origin: refs[0].origin,
      edited: false,
    });
  const confirmed = item.sourceRefs.some((r) => r.kind === "confirmation");
  const question = ctx.questions.find((q) => q.split.id === item.splitId);
  const recheckQuestion = ctx.questions.find(
    (q) => q.probe.kind === "recheck" && q.probe.splitId === item.splitId,
  );
  const recheck = recheckText[item.recheck];
  // A list only once wording exists to confirm: before that, nobody is waited on.
  const showConfirmations = confirmed || item.confirmedBy.length > 0;
  const hasSources = quotes.length > 0 || showConfirmations || !!question || !!recheckQuestion;
  return (
    <li id={anchor("item", item.id)} className="record-item" data-category={item.category}>
      {item.category === "stated" ? (
        <QuoteBlock
          quote={item.text}
          segment={statedSegment}
          speaker={speakerOf(source, ctx.people)}
        />
      ) : (
        <>
          <p className="record-status">
            <StatusLabel status={item.category === "confirmed" ? "confirmed" : "unresolved"} />
          </p>
          <p className="record-text">{item.text}</p>
        </>
      )}
      {item.deadline && (
        <p>
          Deadline: {item.deadline.text}
          {item.deadline.date && <> ({item.deadline.date})</>}
          {item.deadline.firmness && <>, {item.deadline.firmness}</>}
        </p>
      )}
      {showConfirmations && (
        <div id={anchor("confirmations", item.id)} className="record-confirmations">
          <p className="record-label">
            {item.category === "confirmed" ? "Confirmed by" : "Confirmations so far"}
          </p>
          <ConfirmList lines={confirmLines(item, ctx.people)} />
        </div>
      )}
      {!showConfirmations && item.absent.length > 0 && (
        <p>Absent, not asked: {nameList(item.absent.map((id) => nameOf(id, ctx.people)))}.</p>
      )}
      {recheck && (
        <p>
          <StatusLabel status={recheck[0]} />: {recheck[1]}
        </p>
      )}
      {hasSources && (
        <ul className="record-sources" aria-label="Sources">
          {quotes.map((r) => (
            <li key={r.segmentId + r.quote}>
              <SourceLink href={`#${anchor("segment", r.segmentId)}`}>
                Transcript: {saidBy(ctx.sources.get(r.segmentId), ctx.people)}
              </SourceLink>
            </li>
          ))}
          {showConfirmations && (
            <li>
              <SourceLink href={`#${anchor("confirmations", item.id)}`}>Who confirmed</SourceLink>
            </li>
          )}
          {question && (
            <li>
              <SourceLink href={`#${anchor("question", question.split.id)}`}>
                Answers to the question
              </SourceLink>
            </li>
          )}
          {recheckQuestion && (
            <li>
              <SourceLink href={`#${anchor("question", recheckQuestion.split.id)}`}>
                Recheck answers
              </SourceLink>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

const sections = [
  { category: "confirmed", heading: "Confirmed by participants", empty: "Nothing confirmed yet." },
  { category: "unresolved", heading: "Unresolved", empty: "Nothing unresolved." },
  {
    category: "stated",
    heading: "Stated in meeting",
    empty: "No decisions were stated in the meeting.",
  },
] as const;

/** Counts only what was asked and answered; it never claims people understood the same thing. */
export function noSplitLine(questions: RevealedSplit[]): string {
  const asked = questions.filter((q) => q.probe.kind === "diagnostic");
  if (asked.length === 0) return "No questions have been revealed yet, so nothing was compared.";
  const same = asked.filter((q) => q.split.outcome === "consistent").length;
  const few = asked.filter((q) => q.split.outcome === "insufficient").length;
  const noun = asked.length === 1 ? "question" : "questions";
  return [
    `No split found on ${same} of ${asked.length} ${noun}.`,
    few > 0 && `${few} had too few answers to compare.`,
    "That doesn't prove everyone understood the same thing.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function RecordView({ data }: { data: RecordResponse }) {
  const { record, validation, questions } = data;
  const people = record.participants;
  const ctx: Context = { people, sources: new Map(data.sources.map((s) => [s.id, s])), questions };
  const itemNumber = new Map(record.items.map((item, i) => [item.id, i + 1]));
  return (
    <article className="record">
      <header>
        <h1>Decision record: {record.title}</h1>
        <p>Meeting held {formatHeldAt(record.heldAt, "UTC")}</p>
        <p>
          Participants:{" "}
          {people.map((p, i) => (
            <span key={p.id}>
              {i > 0 && " "}
              <SpeakerChip name={p.displayName} simulated={p.isSimulated} />
            </span>
          ))}
        </p>
        <div className="record-actions">
          <Button variant="secondary" onClick={() => window.print()}>
            Print record
          </Button>
        </div>
      </header>
      {people.some((p) => p.isSimulated) && <SimulatedBanner />}
      {record.items.some((i) =>
        i.sourceRefs.some((r) => r.kind === "segment" && r.origin === "asr"),
      ) && (
        <Banner label="Automatic transcription">
          Quotes marked &quot;From automatic transcription&quot; may not be the exact words said.
        </Banner>
      )}
      {sections.map((s) => {
        const items = record.items.filter((i) => i.category === s.category);
        return (
          <section key={s.category} aria-labelledby={`record-${s.category}`}>
            <h2 id={`record-${s.category}`}>{s.heading}</h2>
            {items.length === 0 ? (
              <p>{s.empty}</p>
            ) : (
              <ul className="record-items">
                {items.map((item) => (
                  <Item key={item.id} item={item} ctx={ctx} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {record.proseDraft && (
        <section aria-labelledby="record-summary">
          <h2 id="record-summary">Summary</h2>
          <p>Written by the model from the record. Check it against the items above.</p>
          <p>{record.proseDraft}</p>
        </section>
      )}
      {questions.length > 0 && (
        <section aria-labelledby="record-questions">
          <h2 id="record-questions">Questions asked</h2>
          {questions.map((q) => (
            <div key={q.split.id} id={anchor("question", q.split.id)} className="record-question">
              {q.probe.kind === "recheck" && <p className="record-kicker">Recheck question</p>}
              <ForkView
                quote={q.quote}
                stem={q.probe.stem}
                options={q.probe.options}
                split={q.split}
                answers={q.answers}
                people={people}
              />
            </div>
          ))}
        </section>
      )}
      {data.sources.length > 0 && (
        <section aria-labelledby="record-transcript">
          <h2 id="record-transcript">Where it was said</h2>
          {data.sources.map((segment) => (
            <div key={segment.id} id={anchor("segment", segment.id)} className="record-segment">
              <QuoteBlock
                quote={segment.text}
                segment={segment}
                speaker={speakerOf(segment, people)}
              />
            </div>
          ))}
        </section>
      )}
      <footer className="record-footer">
        <p className="record-no-split">{noSplitLine(questions)}</p>
        <h2>Record checks</h2>
        {validation.ok ? (
          <p>Every item passed the record checks.</p>
        ) : (
          <ul>
            {validation.findings.map((f, i) => (
              <li key={i}>
                {f.itemId && itemNumber.has(f.itemId) && (
                  <>
                    <SourceLink href={`#${anchor("item", f.itemId)}`}>
                      Item {itemNumber.get(f.itemId)}
                    </SourceLink>
                    :{" "}
                  </>
                )}
                {f.detail || f.rule}
              </li>
            ))}
          </ul>
        )}
      </footer>
    </article>
  );
}

/** Loads the record for an organizer (`meetingId`) or a participant (`token`). */
export function RecordPage(props: { meetingId: string } | { token: string }) {
  const [loaded, setLoaded] = useState<Loaded<RecordResponse>>({ state: "loading" });
  const meetingId = "meetingId" in props ? props.meetingId : null;
  const token = "token" in props ? props.token : null;

  useEffect(() => {
    let live = true;
    async function load() {
      let res;
      if (meetingId !== null) {
        const organizer = organizerToken(meetingId);
        if (organizer === null) {
          setLoaded({ state: "error", message: MISSING_KEY, status: null });
          return;
        }
        res = await callApi<RecordResponse>(
          `/api/meetings/${encodeURIComponent(meetingId)}/record`,
          { token: organizer },
        );
      } else {
        res = await callApi<RecordResponse>(`/api/p/${encodeURIComponent(token ?? "")}/record`);
      }
      if (!live) return;
      setLoaded(
        res.ok
          ? { state: "ready", data: res.data }
          : { state: "error", message: res.message, status: res.status },
      );
    }
    void load();
    return () => {
      live = false;
    };
  }, [meetingId, token]);

  if (loaded.state === "loading") return <Loading>Building the record.</Loading>;
  if (loaded.state === "error") {
    return <PageError title="The record didn't open">{loaded.message}</PageError>;
  }
  return <RecordView data={loaded.data} />;
}
