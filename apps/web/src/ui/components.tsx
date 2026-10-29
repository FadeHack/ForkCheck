import type { Answer, ProbeOption, Segment, Split } from "@forkcheck/core";
import { outcomeLabel, SIMULATED } from "./labels";

export function Loading({ children }: { children: string }) {
  return <p role="status">{children}</p>;
}

export function ErrorNotice({ children }: { children: string }) {
  return (
    <div role="alert">
      <p>{children}</p>
    </div>
  );
}

export function SimulatedTag() {
  return <strong> ({SIMULATED})</strong>;
}

function timestamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function QuoteBlock({
  quote,
  segment,
  speaker,
}: {
  quote: string;
  segment: Segment | undefined;
  speaker: string | null;
}) {
  return (
    <figure>
      <blockquote>
        <p>{quote}</p>
      </blockquote>
      <figcaption>
        {speaker ?? "Unknown speaker"}
        {segment?.startMs != null && <> at {timestamp(segment.startMs)}</>}
        {segment?.origin === "asr" && <>. From automatic transcription</>}
        {segment?.edited && <>. Edited</>}
      </figcaption>
    </figure>
  );
}

/** Who chose what on one revealed question. Names come from `names`; others are counted. */
export function ForkList({
  stem,
  options,
  split,
  answers,
  names,
}: {
  stem: string;
  options: ProbeOption[];
  split: Split;
  answers: Answer[];
  names: ReadonlyMap<string, string>;
}) {
  const optionOf = (a: Answer) => (a.choice === "option" ? a.optionId : a.mappedOptionId);
  const who = (list: Answer[]) => {
    const named = list.flatMap((a) => {
      const name = names.get(a.participantId);
      return name === undefined ? [] : [a.simulated ? `${name} (${SIMULATED})` : name];
    });
    const others = list.length - named.length;
    if (others > 0) named.push(others === 1 ? "1 other person" : `${others} other people`);
    return named.join(", ");
  };
  const unsure = answers.filter((a) => a.choice === "unsure");
  const unmatched = answers.filter((a) => a.choice === "write_in" && a.mappedOptionId === null);
  const chosen = options.filter((o) => answers.some((a) => optionOf(a) === o.id));
  const answeredCount = answers.length - unsure.length;
  return (
    <article>
      <h3>{stem}</h3>
      <p>
        <strong>{outcomeLabel[split.outcome]}</strong>
        {split.outcome === "split" && <>: a difference to discuss.</>}
        {split.outcome === "consistent" && <> ({answeredCount} answered).</>}
      </p>
      {chosen.length > 0 && (
        <ul>
          {chosen.map((o) => {
            const list = answers.filter((a) => optionOf(a) === o.id);
            const mapped = list.filter((a) => a.mappedByModel);
            return (
              <li key={o.id}>
                <p>{o.text}</p>
                <p>Chosen by {who(list)}</p>
                {mapped.length > 0 && (
                  <p>
                    Matched by the model from a written answer:{" "}
                    {mapped.map((a) => `"${a.writeInText}"`).join(", ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {unsure.length > 0 && <p>Not sure: {who(unsure)}</p>}
      {unmatched.length > 0 && (
        <p>
          Written answers with no matching option:{" "}
          {unmatched.map((a) => `"${a.writeInText}"`).join(", ")}
        </p>
      )}
    </article>
  );
}
