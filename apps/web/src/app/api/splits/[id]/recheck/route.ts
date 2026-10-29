import { withOrganizerOf } from "../../../../../server/auth";
import { startRecheck } from "../../../../../server/recheck";

export const POST = withOrganizerOf(
  async (deps, id) => {
    const split = await deps.splits.get(id);
    return split && ((await deps.rounds.getProbe(split.probeId))?.probe.meetingId ?? null);
  },
  async (_req, { deps, meeting, params }) => startRecheck(deps, meeting, params.id),
);
