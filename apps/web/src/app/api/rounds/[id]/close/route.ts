import { withOrganizerOf } from "../../../../../server/auth";
import { closeRound } from "../../../../../server/reveal";

export const POST = withOrganizerOf(
  async (deps, id) => (await deps.rounds.get(id))?.meetingId ?? null,
  async (_req, { deps, meeting, params }) =>
    closeRound(deps, meeting, (await deps.rounds.get(params.id))!),
);
