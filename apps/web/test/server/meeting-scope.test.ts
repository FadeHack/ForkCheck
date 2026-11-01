import { fixtureKey, ScriptedProvider, type ModelRequest } from "@forkcheck/ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MeetingScopedProvider, SCOPED_MEETING_ID } from "../../src/server/meeting-scope";

const schema = z.object({ segmentId: z.string(), note: z.string() });

function request(meetingId: string): ModelRequest<z.infer<typeof schema>> {
  return {
    stage: "extract",
    promptVersion: "extract.v1",
    schema,
    reasoningEffort: "low",
    messages: [
      { role: "developer", content: "Find decisions." },
      { role: "user", content: `[${meetingId}:seg:3] Marco: I'll have it ready by Friday.` },
    ],
  };
}

describe("MeetingScopedProvider", () => {
  it("sends the same request for two meetings, so they share one fixture", async () => {
    const inner = new ScriptedProvider({
      extract: [
        { segmentId: `${SCOPED_MEETING_ID}:seg:3`, note: "" },
        { segmentId: `${SCOPED_MEETING_ID}:seg:3`, note: "" },
      ],
    });
    await new MeetingScopedProvider(inner, "a1b2").call(request("a1b2"));
    await new MeetingScopedProvider(inner, "c3d4").call(request("c3d4"));

    const [first, second] = inner.requests;
    expect(first!.messages[1]!.content).toBe(
      `[${SCOPED_MEETING_ID}:seg:3] Marco: I'll have it ready by Friday.`,
    );
    expect(fixtureKey(first!)).toEqual(fixtureKey(second!));
  });

  it("maps ID prefixes in the output back to the meeting, and leaves other text alone", async () => {
    const inner = new ScriptedProvider({
      extract: [
        { segmentId: `${SCOPED_MEETING_ID}:seg:3`, note: `called ${SCOPED_MEETING_ID} once` },
      ],
    });
    const { output } = await new MeetingScopedProvider(inner, "a1b2").call(request("a1b2"));
    expect(output).toEqual({ segmentId: "a1b2:seg:3", note: `called ${SCOPED_MEETING_ID} once` });
  });
});
