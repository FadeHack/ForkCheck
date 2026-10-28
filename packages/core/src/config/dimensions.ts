import { dimension, type Dimension } from "../model/analysis";

/** Dimension names as the UI shows them. */
export const DIMENSION_LABELS: Record<Dimension, string> = {
  owner: "Owner",
  deadline: "Deadline",
  scope: "Scope",
  criteria: "Acceptance criteria",
  dependency: "Dependency",
  outcome: "Expected outcome",
};

/** The M3.5 fallback set: the dimensions with a T0 template (owner, deadline firmness, deliverable form). */
export const NARROWED_DIMENSIONS: readonly Dimension[] = ["owner", "deadline", "scope"];

/**
 * Reads PROBE_DIMENSIONS: unset, empty or "all" checks every dimension, "narrow" is the
 * fallback set, otherwise a comma-separated list. An unknown name throws, so a typo can't
 * silently switch checks off.
 */
export function parseProbeDimensions(raw: string | undefined): readonly Dimension[] {
  const value = raw?.trim() ?? "";
  if (value === "" || value === "all") return dimension.options;
  if (value === "narrow") return NARROWED_DIMENSIONS;
  const picked = new Set<Dimension>();
  for (const part of value.split(",")) {
    const name = part.trim();
    const parsed = dimension.safeParse(name);
    if (!parsed.success) {
      throw new Error(
        `PROBE_DIMENSIONS: unknown dimension "${name}"; use ${dimension.options.join(", ")}, all or narrow`,
      );
    }
    picked.add(parsed.data);
  }
  return dimension.options.filter((d) => picked.has(d));
}

function list(names: string[], join: "and" | "or"): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${join} ${names.at(-1)}`;
}

/** UI note on which dimensions are checked; null when all of them are. */
export function checkedDimensionsNote(checked: readonly Dimension[]): string | null {
  const skipped = dimension.options.filter((d) => !checked.includes(d));
  if (skipped.length === 0) return null;
  const on = list(
    checked.map((d) => DIMENSION_LABELS[d]),
    "and",
  );
  const off = list(
    skipped.map((d) => DIMENSION_LABELS[d].toLowerCase()),
    "or",
  );
  return `Questions only cover ${on}. ForkCheck doesn't ask about ${off}, so differences there won't show up.`;
}
