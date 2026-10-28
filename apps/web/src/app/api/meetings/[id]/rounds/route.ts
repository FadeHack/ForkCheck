import { openRoundRequest } from "../../../../../contracts/api";
import { withOrganizer } from "../../../../../server/auth";
import { readBody } from "../../../../../server/http";
import { openRound } from "../../../../../server/rounds";

export const POST = withOrganizer(async (req, { deps, meeting }) => {
  const body = await readBody(req, openRoundRequest);
  return body.ok ? openRound(deps, meeting, body.data) : body.response;
});
