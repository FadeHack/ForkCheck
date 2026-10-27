import { describe, expect, it } from "vitest";
import {
  createMeetingRequest,
  editSegmentRequest,
  submitAnswerRequest,
} from "../src/contracts/api";

describe("API request contracts", () => {
  it("parses a create-meeting request with a pasted transcript", () => {
    const body = {
      title: "SSO sync",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      participants: ["Priya", "Marco"],
      transcript: "Priya: SSO is ready by Friday.",
    };
    expect(createMeetingRequest.parse(body)).toEqual(body);
  });

  it("rejects a meeting with one participant", () => {
    const body = {
      title: "Solo",
      heldAt: "2026-10-26T15:00:00Z",
      timezone: "UTC",
      participants: ["Priya"],
    };
    expect(createMeetingRequest.safeParse(body).success).toBe(false);
  });

  it("requires optionId exactly for option answers", () => {
    expect(submitAnswerRequest.safeParse({ probeId: "p1", choice: "option" }).success).toBe(false);
    expect(
      submitAnswerRequest.safeParse({ probeId: "p1", choice: "unsure", optionId: "o1" }).success,
    ).toBe(false);
    expect(submitAnswerRequest.safeParse({ probeId: "p1", choice: "unsure" }).success).toBe(true);
  });

  it("rejects an empty segment edit", () => {
    expect(editSegmentRequest.safeParse({}).success).toBe(false);
    expect(editSegmentRequest.safeParse({ participantId: null }).success).toBe(true);
  });
});
