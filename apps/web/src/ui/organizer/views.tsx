import Link from "next/link";
import type { OrganizerMeetingState } from "../../contracts/api";
import { ForkView, SpeakerChip, StatusLabel } from "../components";
import { splitStatusLabel, validityText } from "../labels";
import { organizerStages, splitsToSettle, type OrganizerStage } from "../stages";

type State = OrganizerMeetingState;

export function participantNames(state: Pick<State, "participants">): Map<string, string> {
  return new Map(state.participants.map((p) => [p.id, p.displayName]));
}

export function StageRail({
  current,
  viewing,
  href,
}: {
  current: OrganizerStage;
  viewing: OrganizerStage;
  href: (stage: OrganizerStage) => string;
}) {
  const currentIdx = organizerStages.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Meeting check stages" className="stage-rail">
      <ol>
        {organizerStages.map((s, i) => (
          <li key={s.id} aria-current={s.id === current ? "step" : undefined}>
            {s.id === "source" ? (
              <>{s.label}, done</>
            ) : i > currentIdx ? (
              <>{s.label}, not yet</>
            ) : s.id === viewing ? (
              <strong>{s.label}</strong>
            ) : (
              <Link href={href(s.id)}>{s.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function RoundView({ state }: { state: State }) {
  const byId = new Map(state.probes.map((p) => [p.id, p]));
  const active = state.participants.filter((p) => p.status === "active");
  return (
    <>
      <section aria-labelledby="progress-heading">
        <h2 id="progress-heading">Answers so far</h2>
        {state.answerCounts.length === 0 ? (
          <p>No questions are open right now.</p>
        ) : (
          <ul>
            {state.answerCounts.map((c) => (
              <li key={c.probeId}>
                {byId.get(c.probeId)?.stem ?? "Question"}: {c.answered} of {c.active} have answered.
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="people-heading">
        <h2 id="people-heading">Participants</h2>
        <p>{active.length} active. Answers stay sealed until they are revealed, for you too.</p>
        <ul>
          {state.participants.map((p) => (
            <li key={p.id}>
              <SpeakerChip name={p.displayName} simulated={p.isSimulated} />
              {p.status === "absent" && <>: absent, not asked</>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function RevealView({ state }: { state: State }) {
  const names = participantNames(state);
  const diagnostic = state.probes.filter((p) => p.kind === "diagnostic");
  const revealed = diagnostic.flatMap((probe) => {
    const split = state.splits.find((s) => s.probeId === probe.id);
    return split ? [{ probe, split }] : [];
  });
  if (revealed.length === 0) return <p>No answers have been revealed yet.</p>;
  return (
    <section aria-labelledby="reveal-heading">
      <h2 id="reveal-heading">Revealed answers</h2>
      {revealed.map(({ probe, split }) => (
        <div key={split.id}>
          <ForkView
            stem={probe.stem}
            options={probe.options}
            split={split}
            answers={state.revealedAnswers.filter((a) => a.probeId === probe.id)}
            names={names}
          />
          {split.validity.length > 0 && (
            <>
              <h4>Is this a real difference?</h4>
              <ul>
                {split.validity.map((v) => (
                  <li key={v.participantId}>
                    {names.get(v.participantId) ?? "A participant"}: {validityText[v.label]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

export function ResolveView({ state }: { state: State }) {
  const names = participantNames(state);
  const toSettle = splitsToSettle(state.splits, state.probes);
  const byId = new Map(state.probes.map((p) => [p.id, p]));
  if (toSettle.length === 0) return <p>There are no differences to resolve.</p>;
  return (
    <section aria-labelledby="resolve-heading">
      <h2 id="resolve-heading">Differences to resolve</h2>
      {toSettle.map((split) => {
        const resolutions = state.resolutions.filter((r) => r.splitId === split.id);
        return (
          <article key={split.id}>
            <h3>{byId.get(split.probeId)?.stem}</h3>
            <p>
              <StatusLabel status={split.status} />
            </p>
            {resolutions.length === 0 ? (
              <p>Nobody has proposed wording yet.</p>
            ) : (
              <ul>
                {resolutions.map((r) => {
                  const confirmed = state.confirmations
                    .filter((c) => c.resolutionId === r.id)
                    .map((c) => names.get(c.participantId) ?? "A participant");
                  return (
                    <li key={r.id}>
                      <blockquote>
                        <p>{r.text}</p>
                      </blockquote>
                      <p>
                        Proposed by {names.get(r.proposedBy) ?? "a participant"}
                        {r.draftedByModel && <>. Drafted by the model</>}
                        {r.status === "superseded" && <>. Replaced by a later proposal</>}
                      </p>
                      <p>
                        {confirmed.length === 0
                          ? "Nobody has confirmed yet."
                          : `Confirmed by ${confirmed.join(", ")}.`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function RecheckView({ state }: { state: State }) {
  const byId = new Map(state.probes.map((p) => [p.id, p]));
  const rechecks = state.probes.filter((p) => p.kind === "recheck");
  if (rechecks.length === 0) {
    return <p>A recheck starts once everyone has confirmed the wording for a difference.</p>;
  }
  return (
    <section aria-labelledby="recheck-heading">
      <h2 id="recheck-heading">Recheck questions</h2>
      <ul>
        {rechecks.map((p) => {
          const original = state.splits.find((s) => s.id === p.splitId);
          const count = state.answerCounts.find((c) => c.probeId === p.id);
          return (
            <li key={p.id}>
              <p>{p.stem}</p>
              {original && <p>Follows up: {byId.get(original.probeId)?.stem}</p>}
              <p>
                {count
                  ? `${count.answered} of ${count.active} have answered.`
                  : original
                    ? splitStatusLabel[original.status]
                    : "Closed."}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RecordLink({ meetingId }: { meetingId: string }) {
  return (
    <p>
      <Link href={`/m/${encodeURIComponent(meetingId)}/record`}>Open record</Link>
    </p>
  );
}
