import type { DecisionRecord, Participant, RecordItem, Segment } from "@forkcheck/core";

const RECHECK: Record<RecordItem["recheck"], string> = {
  passed: "passed",
  failed: "failed",
  not_conclusive: "not conclusive",
  not_run: "not run yet",
};

/** The record as Markdown, for reading a headless run. */
export function renderRecordMarkdown(
  record: DecisionRecord,
  segments: Pick<Segment, "id" | "participantId">[],
): string {
  const names = new Map<string, string>(
    record.participants.map((p: Participant) => [p.id, p.displayName]),
  );
  const name = (id: string) => names.get(id) ?? id;
  const speaker = new Map(segments.map((s) => [s.id, s.participantId]));
  const items = (category: RecordItem["category"]) =>
    record.items.filter((i) => i.category === category);

  const stated = items("stated").map((i) => {
    const ref = i.sourceRefs[0];
    if (ref?.kind !== "segment") return `- "${i.text}"`;
    const who = speaker.get(ref.segmentId);
    const badge = ref.origin === "asr" ? " (wording from transcription)" : "";
    return `- ${who ? `${name(who)}: ` : ""}"${i.text}"${badge}`;
  });
  const confirmed = items("confirmed").map((i) => {
    const lines = [`- ${i.text}`, `  Confirmed by ${i.confirmedBy.map(name).join(", ")}.`];
    for (const id of i.absent) lines.push(`  ${name(id)} absent, not confirmed.`);
    lines.push(`  Recheck: ${RECHECK[i.recheck]}.`);
    if (i.deadline) {
      lines.push(
        `  Deadline: ${i.deadline.date ?? i.deadline.text} (${i.deadline.firmness ?? "no firmness"}).`,
      );
    }
    return lines.join("\n");
  });
  const unresolved = items("unresolved").map((i) =>
    i.recheck === "failed" ? `- ${i.text}\n  Recheck: failed.` : `- ${i.text}`,
  );
  const section = (heading: string, lines: string[]) =>
    [`## ${heading}`, "", ...(lines.length > 0 ? lines : ["None."])].join("\n");

  return [
    `# ${record.title}`,
    "",
    `Held ${record.heldAt}. Participants: ${record.participants.map((p) => p.displayName).join(", ")}.`,
    "",
    section("Stated in the meeting", stated),
    "",
    section("Confirmed by participants", confirmed),
    "",
    section("Unresolved", unresolved),
    "",
    section(
      "Draft summary (written by the model, not part of the record)",
      record.proseDraft ? [record.proseDraft] : [],
    ),
    "",
  ].join("\n");
}
