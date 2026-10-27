import { findVagueTerms } from "./dates";
import type { Decision, Dimension, Evidence } from "./model/analysis";
import type { Meeting, Participant, Segment } from "./model/meeting";
import type {
  DecisionRecord,
  RecordDeadline,
  RecordItem,
  RecordValidation,
  SourceRef,
} from "./model/record";
import { verifyQuote } from "./quote";
import { currentResolution, everyoneConfirmed, type ResolutionState } from "./resolution";

/** One split raised on a decision, with where the resolution loop left it. */
export interface RecordSplit {
  decisionId: string;
  dimension: Dimension;
  state: ResolutionState;
  /** The deadline participants confirmed with the resolution, if it sets one. */
  deadline: RecordDeadline | null;
}

export interface RecordInput {
  meeting: Pick<Meeting, "id" | "title" | "heldAt">;
  generatedAt: string;
  /** Statuses here are the truth for who is absent; the split states follow them. */
  participants: Participant[];
  segments: Pick<Segment, "id" | "text" | "origin">[];
  decisions: {
    decision: Pick<Decision, "id" | "statement">;
    evidence: Pick<Evidence, "segmentId" | "quote">[];
  }[];
  splits: RecordSplit[];
}

type Draft = Omit<RecordItem, "id" | "meetingId">;

const CLOSED: readonly string[] = ["confirmed", "rechecked"];

const withMeetingStatuses = (state: ResolutionState, participants: Participant[]) => ({
  ...state,
  participants: participants.map(({ id, status }) => ({ id, status })),
});

/** Every reason a confirmed resolution cannot sit in `confirmed`, as short phrases. */
function confirmedProblems(text: string, deadline: RecordDeadline | null): string[] {
  const out = [...findVagueTerms(text), ...findVagueTerms(deadline?.text ?? "")].map(
    (t) => `"${t}" is vague`,
  );
  if (deadline && deadline.date === null) out.push("the deadline has no date");
  if (deadline && deadline.firmness === null) out.push("the deadline is not marked firm or target");
  return out;
}

function recheckOf(state: ResolutionState): RecordItem["recheck"] {
  if (state.status === "rechecked") return "passed";
  if (state.status === "reopened") return "failed";
  if (state.status === "confirmed" && state.recheckInconclusive) return "not_conclusive";
  return "not_run";
}

/**
 * R§1 record. Stated items are verified transcript quotes only. Confirmed items are
 * participant-submitted resolutions every active participant confirmed, with no vague
 * term and, if they set a deadline, a date and a firmness. Everything else from a split
 * is unresolved, with the reason in its text.
 */
export function buildRecord(input: RecordInput): DecisionRecord {
  const segments = new Map(input.segments.map((s) => [s.id, s]));
  const absent = input.participants.filter((p) => p.status === "absent").map((p) => p.id);

  const quoteRefs = (decisionId: string): SourceRef[] =>
    (input.decisions.find((d) => d.decision.id === decisionId)?.evidence ?? []).flatMap((e) => {
      const segment = segments.get(e.segmentId);
      if (!segment || !verifyQuote(segment, e.quote).ok) return [];
      return [{ kind: "segment", segmentId: e.segmentId, quote: e.quote, origin: segment.origin }];
    });

  const drafts: Draft[] = [];
  for (const { decision } of input.decisions) {
    for (const ref of quoteRefs(decision.id)) {
      if (ref.kind !== "segment") continue;
      drafts.push({
        category: "stated",
        text: ref.quote,
        sourceRefs: [ref],
        confirmedBy: [],
        absent: [],
        recheck: "not_run",
        splitId: null,
        deadline: null,
      });
    }
  }

  for (const split of input.splits) {
    const state = withMeetingStatuses(split.state, input.participants);
    const decision = input.decisions.find((d) => d.decision.id === split.decisionId)?.decision;
    const statement = decision?.statement ?? split.decisionId;
    const current = currentResolution(state);
    const confirmedBy = current
      ? state.confirmations.filter((c) => c.resolutionId === current.id).map((c) => c.participantId)
      : [];
    const base = {
      sourceRefs: quoteRefs(split.decisionId),
      confirmedBy,
      absent,
      recheck: recheckOf(state),
      splitId: state.splitId,
      deadline: null,
    };

    if (CLOSED.includes(state.status) && current && everyoneConfirmed(state)) {
      const problems = confirmedProblems(current.text, split.deadline);
      if (problems.length === 0) {
        drafts.push({
          ...base,
          category: "confirmed",
          text: current.text,
          sourceRefs: [{ kind: "confirmation", resolutionId: current.id }, ...base.sourceRefs],
          deadline: split.deadline,
        });
      } else {
        drafts.push({
          ...base,
          category: "unresolved",
          text: `Confirmed, but ${problems.join(", ")}: ${current.text}`,
        });
      }
      continue;
    }

    const text =
      state.status === "unresolved"
        ? `Left open by agreement (${split.dimension}): ${statement}`
        : state.status === "reopened" && current
          ? `A recheck found different readings of: ${current.text}`
          : current
            ? `Not confirmed by everyone: ${current.text}`
            : `Participants read the ${split.dimension} differently: ${statement}`;
    drafts.push({ ...base, category: "unresolved", text });
  }

  return {
    meetingId: input.meeting.id,
    title: input.meeting.title,
    heldAt: input.meeting.heldAt,
    generatedAt: input.generatedAt,
    participants: input.participants,
    items: drafts.map((d, i) => ({
      id: `${input.meeting.id}:item:${i}`,
      meetingId: input.meeting.id,
      ...d,
    })),
    proseDraft: null,
  };
}

export type RecordRule =
  | "source_required"
  | "stated_quote_verified"
  | "confirmed_text_from_resolution"
  | "confirmed_by_all_active"
  | "absent_named"
  | "confirmed_split_closed"
  | "confirmed_deadline_concrete"
  | "confirmed_not_vague";

/** R§5.5 record rules, checked against the inputs the record was built from. */
export function validateRecord(record: DecisionRecord, input: RecordInput): RecordValidation {
  const findings: RecordValidation["findings"] = [];
  const flag = (rule: RecordRule, item: RecordItem, detail: string) =>
    findings.push({ rule, itemId: item.id, detail });
  const segments = new Map(input.segments.map((s) => [s.id, s]));
  const active = input.participants.filter((p) => p.status === "active").map((p) => p.id);
  const absent = input.participants.filter((p) => p.status === "absent").map((p) => p.id);
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

  for (const item of record.items) {
    if (item.sourceRefs.length === 0) flag("source_required", item, "no quote or confirmation");

    if (item.category === "stated") {
      const ok =
        item.sourceRefs.length > 0 &&
        item.sourceRefs.every((r) => {
          if (r.kind !== "segment") return false;
          const segment = segments.get(r.segmentId);
          return segment !== undefined && verifyQuote(segment, r.quote).ok;
        }) &&
        item.sourceRefs.some((r) => r.kind === "segment" && r.quote === item.text);
      if (!ok) flag("stated_quote_verified", item, "stated text is not a verified quote");
    }

    if (item.category !== "confirmed") continue;

    const resolutionIds = item.sourceRefs.flatMap((r) =>
      r.kind === "confirmation" ? [r.resolutionId] : [],
    );
    const split = input.splits.find((s) => s.state.splitId === item.splitId);
    const resolution = split?.state.resolutions.find((r) => resolutionIds.includes(r.id));
    if (
      !split ||
      !resolution ||
      resolution.text !== item.text ||
      resolution.status !== "confirmed"
    ) {
      flag(
        "confirmed_text_from_resolution",
        item,
        "text is not a confirmed resolution a participant submitted",
      );
    }

    const confirmers = new Set(
      (split?.state.confirmations ?? [])
        .filter((c) => c.resolutionId === resolution?.id)
        .map((c) => c.participantId),
    );
    const missing = active.filter((id) => !item.confirmedBy.includes(id) || !confirmers.has(id));
    const unknown = item.confirmedBy.filter((id) => !confirmers.has(id));
    if (active.length === 0 || missing.length > 0 || unknown.length > 0) {
      flag(
        "confirmed_by_all_active",
        item,
        `missing ${missing.join(", ") || "none"}; not confirmers ${unknown.join(", ") || "none"}`,
      );
    }
    if (!sameSet(item.absent, absent)) {
      flag("absent_named", item, `absent should be [${absent.join(", ")}]`);
    }
    if (!split || !CLOSED.includes(split.state.status)) {
      flag("confirmed_split_closed", item, `split is ${split?.state.status ?? "missing"}`);
    }
    if (item.deadline && (item.deadline.date === null || item.deadline.firmness === null)) {
      flag("confirmed_deadline_concrete", item, "a deadline needs a date and firm or target");
    }
    const vague = [...findVagueTerms(item.text), ...findVagueTerms(item.deadline?.text ?? "")];
    if (vague.length > 0) flag("confirmed_not_vague", item, `vague: ${vague.join(", ")}`);
  }

  return { ok: findings.length === 0, findings };
}
