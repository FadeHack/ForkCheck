import type {
  Decision,
  Dimension,
  LintFinding,
  ProbeTier,
  Split,
  SplitStatus,
  ValidityLabel,
} from "@forkcheck/core";

export const dimensionLabel: Record<Dimension, string> = {
  owner: "Owner",
  deadline: "Deadline",
  scope: "Scope",
  criteria: "Acceptance criteria",
  dependency: "Dependency",
  outcome: "Expected outcome",
};

export const tierLabel: Record<ProbeTier, string> = {
  template: "Template",
  assisted: "Template with model options",
  free: "Model-written",
};

export const decisionStatusLabel: Record<Decision["status"], string> = {
  explicit: "Stated clearly",
  ambiguous: "Open to more than one reading",
  unresolved: "Left open",
  debated: "Still being debated",
};

/** A lint finding as a sentence that names the problem and the fix (the detail is for logs). */
export function lintNote({ rule, detail }: LintFinding): string {
  switch (rule) {
    case "option_count": {
      const n = /^(\d+)/.exec(detail)?.[1];
      return `${n ? `Has ${n} options. ` : ""}A question needs 2 to 4 options.`;
    }
    case "length_ratio":
      return "One option is much longer than another, which hints at the answer. Make them similar in length.";
    case "verbatim_speaker": {
      const m = /option (\d+) repeats "(.*)"/.exec(detail);
      return m
        ? `Option ${m[1]} repeats what someone said ("${m[2]}"), which points at one person. Reword it.`
        : "An option repeats what someone said, which points at one person. Reword it.";
    }
    case "presupposition": {
      const word = /stem uses "(.*)"/.exec(detail)?.[1];
      return word
        ? `Uses the word "${word}", which presumes the answer. Ask without it.`
        : "Its wording presumes the answer. Ask it neutrally.";
    }
    case "one_dimension":
      return "Asks about more than one thing. Keep it to one question.";
    case "debated_target":
      return "Asks about a decision the meeting was still debating, so there is nothing settled to check.";
    case "duplicate":
      return "Asks the same thing as another question. Withdraw one of them.";
    default:
      return detail || rule;
  }
}

/** "Dana", "Dana and Leo", "Dana, Leo and Sam". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/** The participant's waiting line: names only, never what anyone chose. */
export function waitingLine(names: readonly string[]): string {
  return names.length === 0
    ? "Everyone has answered. Answers show here once the organizer reveals them."
    : `Waiting for ${nameList(names)}.`;
}

export const outcomeLabel: Record<Split["outcome"], string> = {
  split: "Different answers",
  consistent: "Same answer",
  insufficient: "Not enough answers",
};

export const splitStatusLabel: Record<SplitStatus, string> = {
  open: "No wording proposed yet",
  resolving: "Waiting for confirmations",
  confirmed: "Confirmed by all",
  rechecked: "Recheck passed",
  reopened: "Reopened",
  unresolved: "Unresolved",
};

export const validityText: Record<ValidityLabel, string> = {
  valid: "Real difference",
  already_discussed: "Already discussed",
  options_dont_differ: "The options mean the same thing",
  redundant: "Same as another question",
  doesnt_matter: "Different, but it doesn't matter",
};

export const SIMULATED = "SIMULATED";
