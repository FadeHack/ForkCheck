import { editProbeRequest } from "../../../../contracts/api";
import { withOrganizerOf } from "../../../../server/auth";
import { readBody } from "../../../../server/http";
import { editProbe } from "../../../../server/rounds";

export const PATCH = withOrganizerOf(
  async (deps, id) => (await deps.rounds.getProbe(id))?.probe.meetingId ?? null,
  async (req, { deps, meeting, params }) => {
    const body = await readBody(req, editProbeRequest);
    return body.ok ? editProbe(deps, meeting, params.id, body.data) : body.response;
  },
);
