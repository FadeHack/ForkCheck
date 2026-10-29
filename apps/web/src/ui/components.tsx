import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Answer, ProbeOption, Segment, Split, SplitStatus } from "@forkcheck/core";
import { outcomeLabel, SIMULATED, splitStatusLabel } from "./labels";

export function Loading({ children }: { children: string }) {
  return (
    <p role="status" className="loading">
      {children}
    </p>
  );
}

export function ErrorNotice({ children }: { children: string }) {
  return (
    <div role="alert" className="notice-error">
      <p>{children}</p>
    </div>
  );
}

export function Button({
  variant = "primary",
  type = "button",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type={type}
      className={["button", `button-${variant}`, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

/**
 * A labeled control with its hint and error wired through `aria-describedby`. The control is
 * rendered by `children`, which receives the ids to describe it with. `check` puts a checkbox
 * before its label.
 */
export function Field({
  id,
  label,
  hint,
  error,
  check = false,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  check?: boolean;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const labelEl = <label htmlFor={id}>{label}</label>;
  return (
    <div className={check ? "field field-check" : "field"}>
      {!check && labelEl}
      {children(describedBy)}
      {check && labelEl}
      {hintId && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {errorId && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function SpeakerChip({ name, simulated = false }: { name: string; simulated?: boolean }) {
  return (
    <span className="speaker">
      {name}
      {simulated && <span className="speaker-simulated"> ({SIMULATED})</span>}
    </span>
  );
}

type GlyphName = "fork" | "stem" | "check" | "ring";

/** The four product glyphs, drawn with the same stroke as the fork line. */
const glyphShapes: Record<GlyphName, ReactNode> = {
  fork: <path d="M3 1v12M3 6h10M3 13h10" />,
  stem: <path d="M3 1v12h10" />,
  check: <path d="M2 8.5l4 4L14 3" />,
  ring: <circle cx="8" cy="8" r="5.5" />,
};

export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
    >
      {glyphShapes[name]}
    </svg>
  );
}

export type Status = Split["outcome"] | SplitStatus | "not_conclusive";

const statuses: Record<
  Status,
  { text: string; glyph: GlyphName; tone: "split" | "confirmed" | "unresolved" | "neutral" }
> = {
  split: { text: outcomeLabel.split, glyph: "fork", tone: "split" },
  consistent: { text: outcomeLabel.consistent, glyph: "stem", tone: "neutral" },
  insufficient: { text: outcomeLabel.insufficient, glyph: "ring", tone: "neutral" },
  open: { text: splitStatusLabel.open, glyph: "ring", tone: "neutral" },
  resolving: { text: splitStatusLabel.resolving, glyph: "ring", tone: "neutral" },
  confirmed: { text: splitStatusLabel.confirmed, glyph: "check", tone: "confirmed" },
  rechecked: { text: splitStatusLabel.rechecked, glyph: "check", tone: "confirmed" },
  reopened: { text: splitStatusLabel.reopened, glyph: "fork", tone: "unresolved" },
  unresolved: { text: splitStatusLabel.unresolved, glyph: "ring", tone: "unresolved" },
  not_conclusive: { text: "Not conclusive", glyph: "ring", tone: "neutral" },
};

/** A state as text plus glyph, so it never depends on color alone. */
export function StatusLabel({ status }: { status: Status }) {
  const { text, glyph, tone } = statuses[status];
  return (
    <span className={`status status-${tone}`}>
      <Glyph name={glyph} />
      {text}
    </span>
  );
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
    <figure className="quote">
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

/** A link to the evidence behind a claim: a transcript segment, a confirmation or a recheck. */
export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href}>{children}</Link>;
}

export function Banner({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="note" className="banner">
      <p>
        <strong>{label}.</strong> {children}
      </p>
    </div>
  );
}

/** Always in the page, so a screen reader is already watching it when a message arrives. */
export function Toast({ message }: { message: string }) {
  return (
    <div role="status" className="toast">
      {message}
    </div>
  );
}

/**
 * One revealed question as a fork: the stem, then a branch per chosen option naming who chose
 * it. Names come from `names`; anyone not in it is counted.
 */
export function ForkView({
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
    <article className="fork" data-outcome={split.outcome}>
      <h3 className="fork-stem">{stem}</h3>
      <p className="fork-status">
        <StatusLabel status={split.outcome} />
        {split.outcome === "split" && <>: a difference to discuss.</>}
        {split.outcome === "consistent" && <> ({answeredCount} answered).</>}
      </p>
      {chosen.length > 0 && (
        <ul className="fork-branches">
          {chosen.map((o) => {
            const list = answers.filter((a) => optionOf(a) === o.id);
            const mapped = list.filter((a) => a.mappedByModel);
            return (
              <li key={o.id} className="fork-branch">
                <p className="fork-option">{o.text}</p>
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
