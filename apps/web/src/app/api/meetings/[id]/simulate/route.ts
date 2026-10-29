import { withOrganizer } from "../../../../../server/auth";
import { answerForSimulated } from "../../../../../server/simulate";

export const POST = withOrganizer(async (_req, { deps, meeting }) =>
  answerForSimulated(deps, meeting),
);
