import { updateParticipantRequest } from "../../../../../../contracts/api";
import { withOrganizer } from "../../../../../../server/auth";
import { readBody } from "../../../../../../server/http";
import { setParticipantStatus } from "../../../../../../server/splits";

export const PATCH = withOrganizer<{ id: string; pid: string }>(
  async (req, { deps, meeting, params }) => {
    const body = await readBody(req, updateParticipantRequest);
    return body.ok
      ? setParticipantStatus(deps, meeting, params.pid, body.data.status)
      : body.response;
  },
);
