import { describe, expect, it } from "vitest";
import type { DecisionRecord, RecordItem } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import { draftRecordProse, draftRecordProseUserMessage } from "../src/index";

const item = (id: string, category: RecordItem["category"], text: string): RecordItem => ({
  id,
  meetingId: "m1",
  category,
  text,
  sourceRefs: [],
  confirmedBy: [],
  absent: [],
  recheck: "not_run",
  splitId: null,
  deadline: null,
});
const record: DecisionRecord = {
  meetingId: "m1",
  title: "Questionnaire",
  heldAt: "2026-10-26T15:00:00-05:00",
  generatedAt: "2026-10-27T17:00:00Z",
  participants: ["Rosa", "Kwame", "Lena"].map((name) => ({
    id: name.toLowerCase(),
    meetingId: "m1",
    displayName: name,
    isSimulated: true,
    status: name === "Lena" ? "absent" : "active",
  })),
  items: [
    item("i0", "stated", "I'll send it back next Friday."),
    {
      ...item("i1", "confirmed", "The questionnaire goes to Brightwater by Friday 2026-10-30."),
      confirmedBy: ["rosa", "kwame"],
      absent: ["lena"],
      recheck: "passed",
      splitId: "split-1",
    },
    item("i2", "unresolved", "Left open by agreement (owner): Who sends the email."),
  ],
  proseDraft: null,
};

const reply = (
  items: { itemId: string; prose: string }[],
  summary = "One item was confirmed.",
) => ({
  draftRecordProse: [{ summary, items }],
});

describe("draftRecordProse", () => {
  it("lists every item with its category, confirmers, absences and recheck", () => {
    expect(draftRecordProseUserMessage({ record }).split("\n")).toEqual([
      "Meeting: Questionnaire",
      "Held: 2026-10-26T15:00:00-05:00",
      "",
      "Items, as [item ID] (category) text",
      "[i0] (stated) I'll send it back next Friday.",
      "[i1] (confirmed) The questionnaire goes to Brightwater by Friday 2026-10-30.; " +
        "confirmed by Rosa, Kwame; absent, not confirmed: Lena; recheck: passed",
      "[i2] (unresolved) Left open by agreement (owner): Who sends the email.",
    ]);
  });

  it("groups item prose under the record's categories after the summary", async () => {
    const model = new ScriptedProvider(
      reply([
        { itemId: "i0", prose: "Kwame said he would send it back next Friday." },
        { itemId: "i2", prose: "Who sends the email is still open." },
        { itemId: "i1", prose: "Brightwater gets the questionnaire by Friday 2026-10-30." },
      ]),
    );
    const { output, trace } = await draftRecordProse({ record }, model);
    expect(output.prose).toBe(
      [
        "One item was confirmed.",
        "Confirmed by participants\n- Brightwater gets the questionnaire by Friday 2026-10-30.",
        "Unresolved\n- Who sends the email is still open.",
        "Stated in the meeting\n- Kwame said he would send it back next Friday.",
      ].join("\n\n"),
    );
    expect(trace.drops).toEqual([]);
  });

  it.each([
    ["unknown_item", { itemId: "i9", prose: "Something else." }],
    ["added_detail", { itemId: "i0", prose: "Kwame sends it back on the 6th." }],
    ["claims_agreement", { itemId: "i2", prose: "The team agreed who sends the email." }],
    ["claims_agreement", { itemId: "i0", prose: "Kwame confirmed he sends it next Friday." }],
    ["empty_prose", { itemId: "i0", prose: "  " }],
  ])("drops %s", async (reason, draft) => {
    const model = new ScriptedProvider(reply([draft]));
    const { output, trace } = await draftRecordProse({ record }, model);
    expect(trace.drops.map((d) => d.reason)).toEqual([reason]);
    expect(output.prose).toBe("One item was confirmed.");
  });

  it("keeps the first prose for an item and drops a repeat", async () => {
    const model = new ScriptedProvider(
      reply([
        { itemId: "i0", prose: "Kwame said next Friday." },
        { itemId: "i0", prose: "Kwame said Friday." },
      ]),
    );
    const { output, trace } = await draftRecordProse({ record }, model);
    expect(output.prose).toContain("- Kwame said next Friday.");
    expect(trace.drops.map((d) => d.reason)).toEqual(["duplicate_item"]);
  });

  it("drops a summary that adds a number", async () => {
    const model = new ScriptedProvider(reply([], "Three items, due on the 6th."));
    const { output, trace } = await draftRecordProse({ record }, model);
    expect(output.prose).toBe("");
    expect(trace.drops.map((d) => d.reason)).toEqual(["added_detail"]);
  });

  it("never changes the record", async () => {
    const before = JSON.stringify(record);
    const model = new ScriptedProvider(reply([{ itemId: "i0", prose: "Kwame said next Friday." }]));
    await draftRecordProse({ record }, model);
    expect(JSON.stringify(record)).toBe(before);
  });
});
