import type { Dimension, ProbeTier, Split, SplitStatus, ValidityLabel } from "@forkcheck/core";

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
