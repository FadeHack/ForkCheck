import { withParticipant } from "../../../../../../../server/auth";
import { confirmResolution } from "../../../../../../../server/splits";

export const POST = withParticipant<{ token: string; rid: string }>(
  async (_req, { deps, participant, params }) => confirmResolution(deps, participant, params.rid),
);
