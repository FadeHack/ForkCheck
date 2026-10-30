import { startTranscriptionRequest } from "../../../../../contracts/api";
import { audioFile } from "../../../../../server/audio";
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

export const GET = withOrganizer(async (_req, { deps, meeting }) => audioFile(deps, meeting));
