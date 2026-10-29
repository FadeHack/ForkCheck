import { draftResolutionRequest, proposeResolutionRequest } from "../../../../../contracts/api";
import { withParticipant } from "../../../../../server/auth";
import { readBody } from "../../../../../server/http";
import { draftResolutionFor, proposeResolution } from "../../../../../server/splits";

export const POST = withParticipant(async (req, { deps, participant }) => {
  if (new URL(req.url).searchParams.get("draft") === "1") {
    const body = await readBody(req, draftResolutionRequest);
    return body.ok ? draftResolutionFor(deps, participant, body.data) : body.response;
  }
  const body = await readBody(req, proposeResolutionRequest);
  return body.ok ? proposeResolution(deps, participant, body.data) : body.response;
});
