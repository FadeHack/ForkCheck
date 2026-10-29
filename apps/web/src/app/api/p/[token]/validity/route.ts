import { labelValidityRequest } from "../../../../../contracts/api";
import { withParticipant } from "../../../../../server/auth";
import { readBody } from "../../../../../server/http";
import { labelValidity } from "../../../../../server/splits";

export const POST = withParticipant(async (req, { deps, participant }) => {
  const body = await readBody(req, labelValidityRequest);
  return body.ok ? labelValidity(deps, participant, body.data) : body.response;
});
