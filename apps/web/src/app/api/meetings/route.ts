import { createMeetingRequest } from "../../../contracts/api";
import { guarded } from "../../../server/auth";
import { getDeps } from "../../../server/deps";
import { json, readBody } from "../../../server/http";
import { createMeeting } from "../../../server/meetings";

export async function POST(req: Request): Promise<Response> {
  return guarded(req, async () => {
    const body = await readBody(req, createMeetingRequest);
    if (!body.ok) return body.response;
    return json(await createMeeting(getDeps(), body.data, new URL(req.url).origin), 201);
  });
}
