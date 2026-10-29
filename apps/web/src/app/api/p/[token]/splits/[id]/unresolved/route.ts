import { withParticipant } from "../../../../../../../server/auth";
import { markUnresolved } from "../../../../../../../server/splits";

export const POST = withParticipant<{ token: string; id: string }>(
  async (_req, { deps, participant, params }) => markUnresolved(deps, participant, params.id),
);
