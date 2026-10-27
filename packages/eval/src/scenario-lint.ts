import type { Scenario } from "./scenario";

export interface ScenarioLintIssue {
  rule: "brief_in_transcript";
  path: (string | number)[];
  message: string;
}

const fold = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Checks the schema cannot express. A brief is a participant's private reading, so
 * finding one word for word in the transcript means the mismatch is stated, not planted.
 */
export function lintScenario(s: Scenario): ScenarioLintIssue[] {
  const transcript = fold(s.transcript);
  const issues: ScenarioLintIssue[] = [];
  s.briefs.forEach((b, i) =>
    b.readings.forEach((r, j) => {
      if (transcript.includes(fold(r.reading))) {
        issues.push({
          rule: "brief_in_transcript",
          path: ["briefs", i, "readings", j],
          message: `${b.participant}'s ${r.dimension} reading for ${r.decision} appears in the transcript`,
        });
      }
    }),
  );
  return issues;
}
