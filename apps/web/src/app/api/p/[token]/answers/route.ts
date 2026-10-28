import { submitAnswerRequest } from "../../../../../contracts/api";
import { withParticipant } from "../../../../../server/auth";
import { readBody } from "../../../../../server/http";
import { submitAnswer } from "../../../../../server/rounds";

export const POST = withParticipant(async (req, { deps, participant }) => {
  const body = await readBody(req, submitAnswerRequest);
  return body.ok ? submitAnswer(deps, participant, body.data) : body.response;
});
