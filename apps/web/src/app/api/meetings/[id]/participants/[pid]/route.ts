import { updateParticipantRequest } from "../../../../../../contracts/api";
import { withOrganizer } from "../../../../../../server/auth";
import { json, notFound, readBody } from "../../../../../../server/http";

export const PATCH = withOrganizer<{ id: string; pid: string }>(
  async (req, { deps, meeting, params }) => {
    const body = await readBody(req, updateParticipantRequest);
    if (!body.ok) return body.response;
    const updated = await deps.meetings.setParticipantStatus(
      meeting.id,
      params.pid,
      body.data.status,
    );
    return updated === null ? notFound("Participant") : json(updated);
  },
);
