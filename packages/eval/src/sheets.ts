import { createHash } from "node:crypto";
import { z } from "zod";
import type { RunLog } from "./metrics";
import type { Scenario } from "./scenario";

/**
 * Human rating sheets (R§7.2, M7.3). One rater, the project owner, fills in three CSV
 * files. Items carry opaque IDs in hash order, so the provider behind a question cannot be
 * read from the sheet; the key that maps IDs back stays in a separate file.
 */
export const SHEETS = {
  questions: {
    file: "questions.csv",
    columns: ["item", "scenario", "question", "options", "clarity", "answerability", "notes"],
  },
  evidence: {
    file: "evidence.csv",
    columns: ["item", "scenario", "claim", "quote", "supports", "notes"],
  },
  simulator: {
    file: "simulator.csv",
    columns: [
      "item",
      "scenario",
      "participant",
      "brief",
      "question",
      "answer",
      "plausible",
      "notes",
    ],
  },
} as const;
export type SheetKind = keyof typeof SHEETS;

/** Printed with every human score in the report (R§7.2). */
export const SINGLE_RATER_NOTE =
  "Human scores come from one rater, the project owner, so no inter-rater agreement is " +
  "reported. Treat them as one careful reader's judgement, not a measured consensus.";

/** Share of evidence quotes sent for the human support check. */
export const EVIDENCE_SAMPLE = 0.2;
/** Scenarios in the simulator spot check. */
export const SIMULATOR_SCENARIOS = 5;

export const sheetKey = z.record(
  z.string(),
  z.strictObject({
    sheet: z.enum(["questions", "evidence", "simulator"]),
    provider: z.enum(["meta", "baseten", "fake"]),
    condition: z.string(),
    runId: z.string(),
    scenario: z.string(),
  }),
);
export type SheetKey = z.infer<typeof sheetKey>;

export interface Sheets {
  questions: string;
  evidence: string;
  simulator: string;
  key: SheetKey;
}

const hash = (seed: string, text: string) =>
  createHash("sha256").update(`${seed}\n${text}`).digest("hex");
const itemId = (prefix: string, seed: string, text: string) =>
  `${prefix}-${hash(seed, text).slice(0, 8)}`;

export function toCsv(columns: readonly string[], rows: Record<string, string>[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))]
    .map((line) => line.map(cell).join(","))
    .join("\n")
    .concat("\n");
}

/** RFC 4180: quoted fields may hold commas, quotes (doubled) and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const condition = (l: RunLog) => `${l.source}/${l.resolution}`;
/** Everything that tells two logs apart; hashed, so none of it reaches the sheet. */
const logRef = (l: RunLog) => `${l.provider}/${l.runId}/${l.run}/${l.scenario}/${condition(l)}`;

/**
 * Builds the three sheets from run logs. Only run 0 of the precise condition is rated, so
 * one rater can finish in about two hours; repeated runs only resample the same prompts.
 * Questions: every first-round probe asked, all providers mixed. Evidence: a fixed-seed
 * sample of `EVIDENCE_SAMPLE` of the quotes. Simulator: every simulated answer in
 * `SIMULATOR_SCENARIOS` scenarios of non-Baseten runs, since the simulator is the same
 * model whatever generated the question.
 */
export function buildSheets(
  scenarios: Map<string, Scenario>,
  allLogs: RunLog[],
  seed: string,
): Sheets {
  const logs = allLogs.filter((l) => l.run === 0 && l.resolution === "precise");
  const key: SheetKey = {};
  const questions: Record<string, string>[] = [];
  const evidence: Record<string, string>[] = [];
  const simulator: Record<string, string>[] = [];
  const keyOf = (sheet: SheetKind, l: RunLog) => ({
    sheet,
    provider: l.provider,
    condition: condition(l),
    runId: l.runId,
    scenario: l.scenario,
  });

  for (const l of logs) {
    for (const r of l.rounds) {
      const item = itemId("q", seed, `${logRef(l)}/${r.probeId}`);
      key[item] = keyOf("questions", l);
      questions.push({
        item,
        scenario: l.scenario,
        question: r.stem,
        options: (r.options ?? []).map((o, i) => `${i + 1}. ${o.text}`).join("\n"),
      });
    }
    const claims = new Map(l.decisions.map((d) => [d.decision.id, d.decision.statement]));
    for (const d of l.decisions) {
      for (const e of d.evidence) {
        const item = itemId("e", seed, `${logRef(l)}/${e.id}`);
        key[item] = keyOf("evidence", l);
        evidence.push({
          item,
          scenario: l.scenario,
          claim: claims.get(d.decision.id) ?? "",
          quote: e.quote,
        });
      }
    }
  }

  const sampled = evidence
    .sort((a, b) => a.item!.localeCompare(b.item!))
    .slice(0, Math.ceil(evidence.length * EVIDENCE_SAMPLE));
  const sampledIds = new Set(sampled.map((r) => r.item));
  for (const id of Object.keys(key)) {
    if (key[id]!.sheet === "evidence" && !sampledIds.has(id)) delete key[id];
  }

  const spotScenarios = [
    ...new Set(
      logs.filter((l) => l.provider !== "baseten" && l.rounds.length > 0).map((l) => l.scenario),
    ),
  ]
    .sort((a, b) => hash(seed, a).localeCompare(hash(seed, b)))
    .slice(0, SIMULATOR_SCENARIOS);
  for (const name of spotScenarios) {
    // One run per scenario is enough to judge whether answers follow the briefs.
    const l = logs.find((x) => x.scenario === name && x.provider !== "baseten")!;
    const s = scenarios.get(name);
    for (const r of l.rounds) {
      for (const a of r.answers ?? []) {
        const brief = s?.briefs.find((b) => b.participant === a.participantId);
        const option = r.options?.find((o) => o.id === a.optionId);
        const item = itemId("s", seed, `${logRef(l)}/${r.probeId}/${a.participantId}`);
        key[item] = keyOf("simulator", l);
        simulator.push({
          item,
          scenario: name,
          participant: a.participantId,
          brief: (brief?.readings ?? []).map((x) => `${x.dimension}: ${x.reading}`).join("\n"),
          question: r.stem,
          answer: a.choice === "option" ? (option?.text ?? a.optionId ?? "") : a.choice,
        });
      }
    }
  }

  const byItem = (a: Record<string, string>, b: Record<string, string>) =>
    a.item!.localeCompare(b.item!);
  return {
    questions: toCsv(SHEETS.questions.columns, questions.sort(byItem)),
    evidence: toCsv(SHEETS.evidence.columns, sampled),
    simulator: toCsv(SHEETS.simulator.columns, simulator.sort(byItem)),
    key,
  };
}

export interface Rating {
  item: string;
  sheet: SheetKind;
  clarity?: number;
  answerability?: number;
  /** Evidence supports its claim, or a simulated answer follows the brief. */
  yes?: boolean;
}

export interface ImportResult {
  ratings: Rating[];
  /** Structural problems: wrong columns, unknown or missing items, out-of-range values. */
  problems: string[];
}

const SCORE = new Set(["1", "2", "3"]);
const YES_NO = new Map([
  ["yes", true],
  ["no", false],
]);

/** Validates completed sheets against the key; any problem means the import is refused. */
export function importSheets(completed: Record<SheetKind, string>, key: SheetKey): ImportResult {
  const ratings: Rating[] = [];
  const problems: string[] = [];
  for (const sheet of Object.keys(SHEETS) as SheetKind[]) {
    const { file, columns } = SHEETS[sheet];
    const [header, ...rows] = parseCsv(completed[sheet]);
    if (!header || header.join(",") !== columns.join(",")) {
      problems.push(`${file}: header must be ${columns.join(",")}`);
      continue;
    }
    const col = (name: string) => columns.indexOf(name as never);
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const line = `${file} row ${i + 2}`;
      const item = row[0] ?? "";
      if (row.length !== columns.length) {
        problems.push(`${line}: ${row.length} cells, expected ${columns.length}`);
        return;
      }
      if (key[item]?.sheet !== sheet) return void problems.push(`${line}: unknown item ${item}`);
      if (seen.has(item)) return void problems.push(`${line}: duplicate item ${item}`);
      seen.add(item);
      if (sheet === "questions") {
        const clarity = row[col("clarity")]!.trim();
        const answerability = row[col("answerability")]!.trim();
        if (!SCORE.has(clarity) || !SCORE.has(answerability)) {
          return void problems.push(`${line}: clarity and answerability must be 1, 2 or 3`);
        }
        ratings.push({
          item,
          sheet,
          clarity: Number(clarity),
          answerability: Number(answerability),
        });
      } else {
        const name = sheet === "evidence" ? "supports" : "plausible";
        const yes = YES_NO.get(row[col(name)]!.trim().toLowerCase());
        if (yes === undefined) return void problems.push(`${line}: ${name} must be yes or no`);
        ratings.push({ item, sheet, yes });
      }
    });
    const missing = Object.entries(key).filter(([id, k]) => k.sheet === sheet && !seen.has(id));
    if (missing.length > 0) problems.push(`${file}: ${missing.length} items not rated`);
  }
  return { ratings, problems };
}

export interface HumanScores {
  /** `provider/source/resolution`, as in the metrics tables. */
  condition: string;
  questions: number;
  clarityMean: number | null;
  answerabilityMean: number | null;
  evidence: { supported: number; of: number };
  simulator: { plausible: number; of: number };
}

export function summarizeRatings(ratings: Rating[], key: SheetKey): HumanScores[] {
  const groups = new Map<string, Rating[]>();
  for (const r of ratings) {
    const k = key[r.item]!;
    const name = `${k.provider}/${k.condition}`;
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rs]) => {
      const q = rs.filter((r) => r.sheet === "questions");
      const e = rs.filter((r) => r.sheet === "evidence");
      const s = rs.filter((r) => r.sheet === "simulator");
      return {
        condition: name,
        questions: q.length,
        clarityMean: mean(q.map((r) => r.clarity!)),
        answerabilityMean: mean(q.map((r) => r.answerability!)),
        evidence: { supported: e.filter((r) => r.yes).length, of: e.length },
        simulator: { plausible: s.filter((r) => r.yes).length, of: s.length },
      };
    });
}
