import { finishReviewRequest } from "../../../../../contracts/api";
import { withOrganizer } from "../../../../../server/auth";
import { apiError, json, readBody } from "../../../../../server/http";
import { finishReview } from "../../../../../server/review";

export const POST = withOrganizer(async (req, { deps, meeting }) => {
  const body = await readBody(req, finishReviewRequest);
  if (!body.ok) return body.response;
  const outcome = await finishReview(deps, meeting, body.data);
  return outcome.ok
    ? json(outcome.response)
    : apiError(outcome.status, outcome.code, outcome.message);
});
