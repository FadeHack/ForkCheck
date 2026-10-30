import { meetingModelCalls } from "@forkcheck/db";
import type { Meeting } from "@forkcheck/core";
import type { TraceResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { meetingRecord } from "./record";

/**
 * The meeting's model calls and the outcomes code computed. Splits exist only once a round
 * has closed, so before the first reveal this holds no trace of anyone's answers.
 */
export async function meetingTrace(deps: Deps, meeting: Meeting): Promise<TraceResponse> {
  const [calls, splits] = await Promise.all([
    meetingModelCalls(deps.db, meeting.id),
    deps.splits.list(meeting.id),
  ]);
  if (splits.length === 0) return { calls, computed: null };
  const { record, questions } = await meetingRecord(deps, meeting, "organizer");
  const outcomes = questions
    .filter((q) => q.probe.kind === "diagnostic")
    .map((q) => q.split.outcome);
  const count = <T>(list: T[], value: T) => list.filter((x) => x === value).length;
  const categories = record.items.map((i) => i.category);
  return {
    calls,
    computed: {
      questions: {
        split: count(outcomes, "split"),
        consistent: count(outcomes, "consistent"),
        insufficient: count(outcomes, "insufficient"),
      },
      confirmations: questions.reduce((n, q) => n + q.confirmations.length, 0),
      record: {
        confirmed: count(categories, "confirmed"),
        unresolved: count(categories, "unresolved"),
        stated: count(categories, "stated"),
      },
    },
  };
}
