import { withOrganizer } from "../../../../server/auth";
import { json, noContent } from "../../../../server/http";
import { organizerState } from "../../../../server/meetings";
import { deleteMeeting } from "../../../../server/retention";

export const GET = withOrganizer(async (_req, { deps, meeting }) =>
  json(await organizerState(deps, meeting)),
);

export const DELETE = withOrganizer(async (_req, { deps, meeting }) => {
  await deleteMeeting(deps, meeting.id);
  return noContent();
});
