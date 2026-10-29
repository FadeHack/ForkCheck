import { withOrganizer } from "../../../../../server/auth";
import { json } from "../../../../../server/http";
import { meetingRecord } from "../../../../../server/record";

export const GET = withOrganizer(async (_req, { deps, meeting }) =>
  json(await meetingRecord(deps, meeting)),
);
