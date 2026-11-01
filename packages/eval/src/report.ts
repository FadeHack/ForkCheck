import { ADOPTION_RULE, type AdoptionResult } from "./adoption";
import { rate, type ConditionMetrics, type Ratio } from "./metrics";
import { SINGLE_RATER_NOTE, type HumanScores } from "./sheets";

export interface ReportInput {
  /** The day of the final run, `YYYY-MM-DD`. */
  date: string;
  conditions: ConditionMetrics[];
  /** Null when the run had no Spark Open condition. */
  adoption: AdoptionResult[] | null;
  /** Null until the rating sheets are imported. */
  human: HumanScores[] | null;
}

const pct = (r: Ratio) => {
  const v = rate(r);
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}% (${r.n}/${r.of})`;
};
const ms = (v: number | null) => (v === null ? "n/a" : `${(v / 1000).toFixed(1)} s`);
const usd = (v: number) => `$${v.toFixed(2)}`;
const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");

type Row = [label: string, target: string, value: (m: ConditionMetrics) => string];

const QUALITY: Row[] = [
  ["S2 precision", "", (m) => pct(m.s2.precision)],
  ["S2 recall", "", (m) => pct(m.s2.recall)],
  ["S2 evidence validity (substring)", "≥ 95%", (m) => pct(m.s2.evidenceValid)],
  ["S2 invented owners or dates", "0", (m) => String(m.s2.invented)],
  ["S3 reveal rate", "≥ 75% held-out", (m) => pct(m.s3.reveal)],
  ["S3 relevance", "", (m) => pct(m.s3.relevance)],
  ["S3 lint pass", "", (m) => pct(m.s3.lintPass)],
  ["S4 precision", "", (m) => pct(m.s4.precision)],
  ["S4 recall", "", (m) => pct(m.s4.recall)],
  [
    "S4 false splits on controls",
    "≤ 1 per 8",
    (m) => `${m.s4.falseSplits} in ${m.s4.controls} control runs`,
  ],
];
const LOOP: Row[] = [
  ["S5 confirmed only with every participant", "100%", (m) => pct(m.s5.confirmedOnlyWithAll)],
  ["S5 resolution events by a model", "0", (m) => String(m.s5.modelActions)],
  ["S6 catch (vague resolution splits)", "≥ 70%", (m) => pct(m.s6.catch)],
  ["S6 pass (precise resolution consistent)", "≥ 80%", (m) => pct(m.s6.pass)],
  ["S6 novel recheck stem", "", (m) => pct(m.s6.novel)],
  ["S7 traceable items", "100%", (m) => pct(m.s7.traceable)],
  ["S7 open splits shown unresolved", "100%", (m) => pct(m.s7.unresolvedVisible)],
  ["S7 inferred text in stated/confirmed", "0", (m) => String(m.s7.inferredText)],
  ["S7 records passing the validator", "100%", (m) => pct(m.s7.validRecords)],
];
const RUNS: Row[] = [
  ["Scenario runs", "", (m) => String(m.scenarios)],
  ["Runs stopped by an error", "", (m) => pct(m.failedRuns)],
];

function metricsTable(conditions: ConditionMetrics[], rows: Row[]): string {
  return table(
    ["Metric", "Target", ...conditions.map((c) => `\`${c.condition}\``)],
    rows.map(([label, target, value]) => [label, target, ...conditions.map(value)]),
  );
}

/** Audio minus paste, in points, for the stages transcription can hurt (R§7.2). */
function audioLoss(paste: ConditionMetrics, audio: ConditionMetrics): string {
  const rows: [string, (m: ConditionMetrics) => Ratio][] = [
    ["S2 precision", (m) => m.s2.precision],
    ["S2 recall", (m) => m.s2.recall],
    ["S2 evidence validity", (m) => m.s2.evidenceValid],
    ["S3 reveal rate", (m) => m.s3.reveal],
    ["S4 precision", (m) => m.s4.precision],
    ["S4 recall", (m) => m.s4.recall],
  ];
  return table(
    ["Metric", `\`${paste.condition}\``, `\`${audio.condition}\``, "Audio − paste"],
    rows.map(([label, f]) => {
      const p = rate(f(paste));
      const a = rate(f(audio));
      const delta = p === null || a === null ? "n/a" : `${((a - p) * 100).toFixed(1)} points`;
      return [label, pct(f(paste)), pct(f(audio)), delta];
    }),
  );
}

function adoptionSection(results: AdoptionResult[]): string {
  const rule =
    `Rule, fixed before the run (R§7.3): Spark Open is a credible alternative for a stage if ` +
    `every quality metric is within ${ADOPTION_RULE.maxGapPoints} points of Muse Spark and JSON ` +
    `validity after repair is at least ${ADOPTION_RULE.minValidAfterRepair * 100}%. ` +
    `The demo path stays on Muse Spark either way.`;
  const rows = results.flatMap((r) => [
    ...r.metrics.map((m) => [
      `${r.stage} ${r.name}`,
      m.metric,
      m.spark === null ? "n/a" : `${(m.spark * 100).toFixed(1)}%`,
      m.open === null ? "n/a" : `${(m.open * 100).toFixed(1)}%`,
      m.gapPoints === null ? "n/a" : `${m.gapPoints > 0 ? "+" : ""}${m.gapPoints}`,
    ]),
    [`${r.stage} ${r.name}`, "JSON valid, first answer", "", pct(r.validFirstTry), ""],
    [`${r.stage} ${r.name}`, "JSON valid after repair", "", pct(r.validAfterRepair), ""],
  ]);
  const verdicts = results.map(
    (r) =>
      `- **${r.stage} ${r.name}:** ${
        r.adopt
          ? "meets the rule; Spark Open is a credible alternative for this stage."
          : `does not meet the rule (${r.reasons.join("; ")}); documented as a comparison only.`
      }`,
  );
  return [
    rule,
    "",
    table(["Stage", "Metric", "Muse Spark", "Spark Open", "Gap (points)"], rows),
    "",
    ...verdicts,
  ].join("\n");
}

function humanSection(human: HumanScores[] | null): string {
  if (!human) return "Not imported yet: the rating sheets have not been completed.";
  return [
    SINGLE_RATER_NOTE,
    "",
    table(
      [
        "Condition",
        "Questions rated",
        "Clarity (1–3)",
        "Answerability (1–3)",
        "Evidence supports claim",
        "Simulated answer follows brief",
      ],
      human.map((h) => [
        `\`${h.condition}\``,
        String(h.questions),
        h.clarityMean === null ? "n/a" : h.clarityMean.toFixed(2),
        h.answerabilityMean === null ? "n/a" : h.answerabilityMean.toFixed(2),
        pct({ n: h.evidence.supported, of: h.evidence.of }),
        pct({ n: h.simulator.plausible, of: h.simulator.of }),
      ]),
    ),
  ].join("\n");
}

function costSection(conditions: ConditionMetrics[]): string {
  const summary = table(
    ["Condition", "Total", "Billed to", "Per meeting", "Calls per meeting", "Failed calls"],
    conditions.map((c) => [
      `\`${c.condition}\``,
      usd(c.cost.totalUsd),
      Object.entries(c.cost.byProvider)
        .map(([p, v]) => `${p} ${usd(v)}`)
        .join(", "),
      `$${c.cost.usdPerMeeting.toFixed(3)}`,
      c.cost.callsPerMeeting.toFixed(1),
      pct(c.cost.failedCalls),
    ]),
  );
  const stages = table(
    ["Condition", "Stage", "Calls", "p50", "p95", "Tokens in / out", "Cost"],
    conditions.flatMap((c) =>
      c.cost.stages.map((s) => [
        `\`${c.condition}\``,
        s.stage,
        String(s.calls),
        ms(s.p50Ms),
        ms(s.p95Ms),
        `${s.inputTokens} / ${s.outputTokens}`,
        `$${s.costUsd.toFixed(3)}`,
      ]),
    ),
  );
  return `${summary}\n\n${stages}`;
}

const LIMITATIONS = [
  "Participants are simulated: Muse Spark answers each probe from a private brief. The simulator " +
    "and the question generator are the same model family, which may push reveal rates up. " +
    "Simulated results do not establish how real teams would answer.",
  "The 26 meetings are synthetic, written for this evaluation with planted mismatches. The audio " +
    "set is 6 synthetic renders and 4 volunteer recordings of scripts.",
  "Pasted and audio runs are reported separately; audio minus paste attributes the loss to " +
    "transcription and speaker mapping.",
  "Model outputs vary between runs; each number sums every logged scenario run of its condition.",
  "Human scores come from a single rater (see above).",
];

/**
 * The evaluation report. Every number comes from the run logs of the listed run IDs, summed
 * per condition; cells give the rate with its count so it can be checked against the logs.
 */
export function renderReport({ date, conditions, adoption, human }: ReportInput): string {
  const paste = conditions.filter((c) => c.condition.includes("/paste/"));
  const audio = conditions.filter((c) => c.condition.includes("/audio/"));
  const loops = conditions.filter((c) => c.s7.validRecords.of > 0);
  const pastePrecise = conditions.find((c) => c.condition === "meta/paste/precise");
  const sources = table(
    ["Condition", "Run IDs", "Logs"],
    conditions.map((c) => [
      `\`${c.condition}\``,
      c.runIds.map((id) => `\`${id}\``).join(", "),
      c.runIds.map((id) => `eval-results/${id}/logs/`).join(", "),
    ]),
  );
  const parts = [
    `# ForkCheck evaluation, ${date}`,
    "",
    "Conditions are `provider/source/resolution`. Each cell is the rate over every logged " +
      "scenario run of the condition, with its count, so any number can be checked against " +
      "the run logs below.",
    "",
    "## Sources",
    "",
    sources,
    "",
    "## Pasted transcripts",
    "",
    metricsTable(paste, [...RUNS, ...QUALITY]),
    "",
  ];
  if (audio.length > 0) {
    parts.push("## Audio", "", metricsTable(audio, [...RUNS, ...QUALITY]), "");
    for (const a of audio) {
      const twin = conditions.find(
        (c) => c.condition === a.condition.replace("/audio/", "/paste/"),
      );
      if (twin) parts.push(audioLoss(twin, a), "");
    }
  }
  if (loops.length > 0) {
    parts.push("## Resolution, recheck and record", "", metricsTable(loops, LOOP), "");
  }
  if (adoption && pastePrecise) {
    parts.push("## Muse Spark and Spark Open", "", adoptionSection(adoption), "");
  }
  parts.push(
    "## Human ratings",
    "",
    humanSection(human),
    "",
    "## Cost and latency",
    "",
    costSection(conditions),
    "",
    "## Limitations",
    "",
    ...LIMITATIONS.map((l) => `- ${l}`),
    "",
  );
  return parts.join("\n");
}
