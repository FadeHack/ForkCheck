import { withParticipant } from "../../../../server/auth";
import { json } from "../../../../server/http";
import { participantState } from "../../../../server/rounds";

export const GET = withParticipant(async (_req, { deps, participant, meeting }) =>
  json(await participantState(deps, participant, meeting)),
);
