import { analyzeMeeting } from "../../../../../server/analyze";
import { withOrganizer } from "../../../../../server/auth";
import { apiError, json } from "../../../../../server/http";

export const POST = withOrganizer(async (_req, { deps, meeting }) => {
  const outcome = await analyzeMeeting(deps, meeting);
  return outcome.ok
    ? json(outcome.response)
    : apiError(outcome.status, outcome.code, outcome.message);
});
