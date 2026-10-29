import { withOrganizer } from "../../../../../server/auth";
import { json } from "../../../../../server/http";
import { meetingTrace } from "../../../../../server/trace";

/** Organizer only: a participant's token gets the same 401 as no token. */
export const GET = withOrganizer(async (_req, { deps, meeting }) =>
  json(await meetingTrace(deps, meeting)),
);
