import { describe, expect, it } from "vitest";
import type { RecordingInfo } from "../../src/ui/audio";
import {
  serverFieldErrors,
  transcriptWarnings,
  validateMeeting,
  type MeetingForm,
} from "../../src/ui/start/validate";

const valid: MeetingForm = {
  title: " Pilot customer check-in ",
  heldAt: "2026-10-26T15:00",
  timezone: "America/New_York",
  participants: "Priya\n\n Marco \n",
  transcript: "Priya: Ready by Friday?\nMarco: Yes.",
  consent: true,
};

describe("validateMeeting", () => {
  it("builds the request from a complete form", () => {
    expect(validateMeeting(valid)).toEqual({
      ok: true,
      body: {
        title: "Pilot customer check-in",
        heldAt: "2026-10-26T19:00:00.000Z",
        timezone: "America/New_York",
        participants: ["Priya", "Marco"],
        transcript: "Priya: Ready by Friday?\nMarco: Yes.",
      },
      keywords: [],
    });
  });

  it("asks for placeholder names only when the box is ticked", () => {
    const on = validateMeeting({ ...valid, pseudonymizeNames: true });
    expect(on.ok && on.body.pseudonymizeNames).toBe(true);
    const off = validateMeeting({ ...valid, pseudonymizeNames: false });
    expect(off.ok && "pseudonymizeNames" in off.body).toBe(false);
  });

  it("asks for a recording instead of a transcript when the source is audio", () => {
    const audio: MeetingForm = { ...valid, source: "audio", transcript: "", recording: null };
    expect(validateMeeting(audio)).toEqual({
      ok: false,
      errors: { recording: "Choose the recording to upload." },
    });
    expect(
      validateMeeting({
        ...audio,
        recording: { size: 1_000_000, durationMs: 120_000 },
        terms: " SSO \n\nOkta\nSSO",
      }),
    ).toEqual({
      ok: true,
      body: {
        title: "Pilot customer check-in",
        heldAt: "2026-10-26T19:00:00.000Z",
        timezone: "America/New_York",
        participants: ["Priya", "Marco"],
      },
      keywords: ["SSO", "Okta"],
    });
  });

  it("refuses a recording that is too long or too large", () => {
    const audio: MeetingForm = { ...valid, source: "audio", transcript: "" };
    const errors = (recording: RecordingInfo) => {
      const res = validateMeeting({ ...audio, recording });
      return res.ok ? null : res.errors.recording;
    };
    expect(errors({ size: 20_000_000, durationMs: 14 * 60_000 + 5_000 })).toBe(
      "This recording is 14 min 5 s. ForkCheck can take up to 10 minutes per recording. Trim it and upload again.",
    );
    expect(errors({ size: 41_200_000, durationMs: null })).toBe(
      "This file is 41.2 MB. ForkCheck can take files up to 32 MB. Trim it, or export it as mono WAV, and upload again.",
    );
    expect(errors({ size: 0, durationMs: null })).toBe(
      "This file is empty. Choose the recording again.",
    );
    // The length is unknown in some browsers; the server checks it after conversion.
    expect(errors({ size: 32_000_000, durationMs: null })).toBeNull();
  });

  it("names the field and the fix for every empty field", () => {
    const result = validateMeeting({
      title: "",
      heldAt: "",
      timezone: "America/New_York",
      participants: "",
      transcript: "  ",
      consent: false,
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        title: "Enter a meeting title.",
        heldAt: "Enter the date and time the meeting started, in the time zone below.",
        participants: "Enter at least two participant names, one per line.",
        transcript: "Paste the meeting transcript.",
        consent: "Confirm that everyone agreed to have this meeting checked.",
      },
    });
  });

  it("blames an unknown zone, not the time it can't read", () => {
    const result = validateMeeting({ ...valid, timezone: "Mars/Olympus" });
    expect(result).toEqual({
      ok: false,
      errors: { timezone: "Enter a time zone name, such as America/New_York." },
    });
  });

  it("asks for different names when one is listed twice", () => {
    const result = validateMeeting({ ...valid, participants: "Sam\nPriya\nsam" });
    expect(result).toEqual({
      ok: false,
      errors: { participants: 'Each participant needs a different name. "sam" is listed twice.' },
    });
  });
});

describe("serverFieldErrors", () => {
  it("replaces the server's wording with the form's own", () => {
    const body = {
      error: {
        code: "invalid_body",
        message: "Some fields are missing or not valid.",
        fields: { "participants.1": ["Too small"], title: ["Too small"], other: ["x"] },
      },
    };
    expect(serverFieldErrors(body)).toEqual({
      participants: "Enter at least two participant names, one per line.",
      title: "Enter a meeting title.",
    });
  });

  it("returns nothing for a body without fields", () => {
    expect(serverFieldErrors(null)).toEqual({});
  });
});

describe("transcriptWarnings", () => {
  it("lists names that aren't participants, once each", () => {
    const transcript = "Priya: Hi.\nSam: Hello.\nPriya: Friday?\nSam: Yes.\nLeo: OK.";
    expect(transcriptWarnings("Priya\nMarco", transcript)).toEqual([
      "3 lines start with names that aren't in the participant list: Sam, Leo. Add them or fix the names.",
    ]);
  });

  it("uses the singular for one line and one name", () => {
    expect(transcriptWarnings("Priya\nMarco", "Priya: Hi.\nSam: Hello.")).toEqual([
      "1 line starts with a name that isn't in the participant list: Sam. Add it or fix the name.",
    ]);
  });

  it("points at lines with no speaker", () => {
    expect(transcriptWarnings("Priya\nMarco", "Hello all.\nPriya: Hi.\n[00:10] ok then")).toEqual([
      'Lines 1 and 3 have no speaker name. Start each with the speaker\'s name, like "Dana: text".',
    ]);
  });

  it("explains a name that matches two participants, spelled as listed", () => {
    expect(transcriptWarnings("Sam\nsam\nPriya", "sam: Hi.")).toEqual([
      "Sam is listed more than once in the participant list, so their lines can't be matched. Give each person a different name.",
    ]);
  });

  it("stays quiet until there are names and a transcript to compare", () => {
    expect(transcriptWarnings("", "Sam: Hi.")).toEqual([]);
    expect(transcriptWarnings("Priya", " ")).toEqual([]);
    expect(transcriptWarnings("Priya\nSam", "Priya: Hi.\nsam: Hello.")).toEqual([]);
  });
});
