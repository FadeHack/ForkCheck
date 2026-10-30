import { startTranscriptionRequest } from "../../../../../contracts/api";
import { withOrganizer } from "../../../../../server/auth";
import { apiError, json, readBody } from "../../../../../server/http";
import { startTranscription } from "../../../../../server/transcribe";

export const POST = withOrganizer(async (req, { deps, meeting }) => {
  const body = await readBody(req, startTranscriptionRequest);
  if (!body.ok) return body.response;
  const outcome = await startTranscription(deps, meeting, body.data);
  return outcome.ok
    ? json(outcome.response, 202)
    : apiError(outcome.status, outcome.code, outcome.message);
});
