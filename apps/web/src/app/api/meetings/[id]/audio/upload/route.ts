import { uploadAudio } from "../../../../../../server/audio";
import { withOrganizer } from "../../../../../../server/auth";
import { apiError, json } from "../../../../../../server/http";

export const POST = withOrganizer(async (req, { deps, meeting }) => {
  const outcome = await uploadAudio(deps, meeting, req);
  return outcome.ok
    ? json(outcome.response, 201)
    : apiError(outcome.status, outcome.code, outcome.message);
});
