import { withParticipant } from "../../../../../server/auth";
import { json } from "../../../../../server/http";
import { meetingRecord } from "../../../../../server/record";

/** The same record the organizer sees, read-only. */
export const GET = withParticipant(async (_req, { deps, meeting }) =>
  json(await meetingRecord(deps, meeting)),
);
