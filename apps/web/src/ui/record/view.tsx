"use client";

import { useEffect, useState } from "react";
import type { RecordItem } from "@forkcheck/core";
import type { RecordResponse } from "../../contracts/api";
import { callApi, organizerToken, type Loaded } from "../api";
import { ErrorNotice, Loading, SimulatedTag } from "../components";
import { formatHeldAt } from "../time";
import { MISSING_KEY } from "../organizer/workspace";

const recheckText: Record<RecordItem["recheck"], string | null> = {
  passed: "Recheck passed: everyone gave the same answer.",
  failed: "Reopened: answers differed, so the wording didn't settle it.",
  not_conclusive: "Not conclusive: not enough answers.",
  not_run: null,
};

function Item({ item, names }: { item: RecordItem; names: ReadonlyMap<string, string> }) {
  const name = (id: string) => names.get(id) ?? "A participant";
  return (
    <li>
      <p>{item.text}</p>
      {item.deadline && (
        <p>
          Deadline: {item.deadline.text}
          {item.deadline.date && <> ({item.deadline.date})</>}
          {item.deadline.firmness && <>, {item.deadline.firmness}</>}
        </p>
      )}
      {item.sourceRefs
        .filter((r) => r.kind === "segment")
        .map((r) => (
          <figure key={r.segmentId + r.quote}>
            <blockquote>
              <p>{r.quote}</p>
            </blockquote>
            {r.origin === "asr" && <figcaption>From automatic transcription</figcaption>}
          </figure>
        ))}
      {item.confirmedBy.length > 0 && <p>Confirmed by {item.confirmedBy.map(name).join(", ")}.</p>}
      {item.absent.length > 0 && <p>Absent, not asked: {item.absent.map(name).join(", ")}.</p>}
      {recheckText[item.recheck] && <p>{recheckText[item.recheck]}</p>}
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

export function RecordView({ data }: { data: RecordResponse }) {
  const { record, validation } = data;
  const names = new Map(record.participants.map((p) => [p.id, p.displayName]));
  return (
    <article>
      <header>
        <h1>Decision record: {record.title}</h1>
        <p>Meeting held {formatHeldAt(record.heldAt, "UTC")}</p>
        <p>
          Participants:{" "}
          {record.participants.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              {p.displayName}
              {p.isSimulated && <SimulatedTag />}
            </span>
          ))}
        </p>
      </header>
      {sections.map((s) => {
        const items = record.items.filter((i) => i.category === s.category);
        return (
          <section key={s.category} aria-labelledby={`record-${s.category}`}>
            <h2 id={`record-${s.category}`}>{s.heading}</h2>
            {items.length === 0 ? (
              <p>{s.empty}</p>
            ) : (
              <ul>
                {items.map((item) => (
                  <Item key={item.id} item={item} names={names} />
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
      <footer>
        <h2>Record checks</h2>
        {validation.ok ? (
          <p>Every item passed the record checks.</p>
        ) : (
          <ul>
            {validation.findings.map((f, i) => (
              <li key={i}>{f.detail || f.rule}</li>
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
  if (loaded.state === "error") return <ErrorNotice>{loaded.message}</ErrorNotice>;
  return <RecordView data={loaded.data} />;
}
