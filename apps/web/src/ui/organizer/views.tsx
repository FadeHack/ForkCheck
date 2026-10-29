import Link from "next/link";
import { probeQuote } from "@forkcheck/core";
import type { OrganizerMeetingState } from "../../contracts/api";
import { RevealList } from "../reveal";
import { splitStatusLabel } from "../labels";
import { organizerStages, type OrganizerStage } from "../stages";

type State = OrganizerMeetingState;

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

/** The reveal and the wording that follows it: the participants' page without the controls. */
export function RevealView({ state }: { state: State }) {
  const items = state.probes
    .filter((p) => p.kind === "diagnostic")
    .flatMap((probe) => {
      const split = state.splits.find((s) => s.probeId === probe.id);
      const answers = state.revealedAnswers.filter((a) => a.probeId === probe.id);
      if (!split) return [];
      const resolutions = state.resolutions.filter((r) => r.splitId === split.id);
      const confirmations = state.confirmations.filter((c) =>
        resolutions.some((r) => r.id === c.resolutionId),
      );
      return [
        { probe, split, quote: probeQuote(probe.id, state), answers, resolutions, confirmations },
      ];
    });
  return <RevealList items={items} people={state.participants} />;
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
