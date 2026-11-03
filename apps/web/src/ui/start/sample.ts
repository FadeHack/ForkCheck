/**
 * The demo meeting from scenarios/demo/atlas-launch.json, as the start form fills it in. Its model
 * replies are recorded, so a check created from it runs without a model key. The date and zone
 * must match the scenario's, because the drafted questions name days relative to them.
 * test/ui/sample.test.ts keeps this in step with the scenario file.
 */
export const SAMPLE_MEETING = {
  title: "Atlas launch sync",
  /** Wall time in `timezone`, the way the date field holds it. */
  heldAt: "2026-11-03T10:00",
  timezone: "America/New_York",
  participants: ["Nadia", "Tomas", "June"],
  transcript: [
    "[00:00] Nadia: Atlas launch. Where are we?",
    "[00:04] Tomas: The dashboards are done. Exports still time out on big accounts, I'm fixing that this week.",
    "[00:12] June: The announcement email is drafted. I need final screenshots.",
    "[00:18] Tomas: You'll have them Thursday.",
    "[00:21] Nadia: Good. I want Atlas out to every customer by the end of next week.",
    "[00:27] Tomas: That works. Reminder that we don't deploy on Fridays.",
    "[00:32] June: Our launch emails do best on a Thursday, so I'd plan around that.",
    "[00:37] Nadia: Fine. End of next week, then.",
    "[00:40] Tomas: I'll turn on the flag for internal accounts tomorrow so support can try it.",
    "[00:46] Nadia: Great. The help center needs a page for Atlas too.",
    "[00:50] June: Yes, it needs screenshots and the export limits.",
    "[00:55] Tomas: Right, the export limits have to be in there.",
    "[00:59] Nadia: So we'll get the help center page done before launch.",
    "[01:03] June: Sounds good.",
    "[01:05] Tomas: Yep.",
    "[01:07] Nadia: Thanks, both.",
    "",
  ].join("\n"),
} as const;
