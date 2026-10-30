import { mapSpeakersRequest } from "../../../../../contracts/api";
import { withOrganizer } from "../../../../../server/auth";
import { apiError, json, readBody } from "../../../../../server/http";
import { mapSpeakers } from "../../../../../server/speakers";

export const PUT = withOrganizer(async (req, { deps, meeting }) => {
  const body = await readBody(req, mapSpeakersRequest);
  if (!body.ok) return body.response;
  const outcome = await mapSpeakers(deps, meeting, body.data);
  return outcome.ok
    ? json(outcome.response)
    : apiError(outcome.status, outcome.code, outcome.message);
});
