import { editSegmentRequest } from "../../../../contracts/api";
import { withOrganizerOf } from "../../../../server/auth";
import { apiError, json, readBody } from "../../../../server/http";
import { editSegment } from "../../../../server/review";

export const PATCH = withOrganizerOf(
  async (deps, id) => (await deps.meetings.segment(id))?.meetingId ?? null,
  async (req, { deps, meeting, params }) => {
    const body = await readBody(req, editSegmentRequest);
    if (!body.ok) return body.response;
    const outcome = await editSegment(deps, meeting, params.id, body.data);
    return outcome.ok
      ? json(outcome.response)
      : apiError(outcome.status, outcome.code, outcome.message);
  },
);
