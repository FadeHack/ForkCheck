import Link from "next/link";
import { probeQuote } from "@forkcheck/core";
import type { OrganizerMeetingState } from "../../contracts/api";
import { RevealList } from "../reveal";
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
  const items = state.probes.flatMap((probe) => {
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

export function RecordLink({ meetingId }: { meetingId: string }) {
  return (
    <p>
      <Link href={`/m/${encodeURIComponent(meetingId)}/record`}>Open record</Link>
    </p>
  );
}
