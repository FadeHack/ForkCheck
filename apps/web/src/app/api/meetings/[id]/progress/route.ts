import { withOrganizer } from "../../../../../server/auth";
import { json } from "../../../../../server/http";
import { meetingProgress } from "../../../../../server/steps";

export const GET = withOrganizer(async (_req, { deps, meeting }) =>
  json(await meetingProgress(deps, meeting)),
);
