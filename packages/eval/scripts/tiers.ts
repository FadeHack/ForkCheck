/**
 * M3.4 tier selection from gate runs.
 * Usage: pnpm tiers eval-results/g1/<run-id> [eval-results/g1/<run-id> ...]
 * Each directory is one tier's gate run. Prints, per dimension, every tier's reveals and
 * control false splits and the tier `pickTier` chooses, and writes it to
 * eval-results/tiers/report.md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dimension } from "@forkcheck/core";
import { gateLog, gateVerdict, pickTier, type TierCandidate } from "../src/index";

const workspace = resolve(import.meta.dirname, "../../..");
const dirs = process.argv.slice(2).filter((a) => a !== "--");
if (dirs.length === 0) {
  console.error("Usage: pnpm tiers <gate run dir> [<gate run dir> ...]");
  process.exit(2);
}

const runs = dirs.map((d) => {
  const logs = join(resolve(d), "logs");
  const parsed = readdirSync(logs)
    .filter((f) => f.endsWith(".json"))
    .map((f) => gateLog.parse(JSON.parse(readFileSync(join(logs, f), "utf8"))));
  const first = parsed[0];
  if (!first) throw new Error(`no logs in ${logs}`);
  return { tier: first.tier, runId: first.runId, verdict: gateVerdict(parsed) };
});

const lines = [
  "# Tier selection",
  "",
  `Gate runs: ${runs.map((r) => `\`${r.runId}\` (${r.tier}, ${r.verdict.runs.length} runs, $${r.verdict.costUsd.toFixed(2)})`).join(", ")}.`,
  "",
  "Pick: highest reveal rate, then fewest control false splits; a tier that never revealed the dimension is not picked.",
  "",
  `| Dimension | ${runs.map((r) => r.tier).join(" | ")} | Pick |`,
  `| --- | ${runs.map(() => "---").join(" | ")} | --- |`,
];
for (const d of dimension.options) {
  const candidates: TierCandidate[] = runs.flatMap((r) => {
    const score = r.verdict.byDimension[d];
    return score ? [{ tier: r.tier, runId: r.runId, score }] : [];
  });
  const cells = runs.map((r) => {
    const s = r.verdict.byDimension[d];
    return s ? `${s.revealed}/${s.of} revealed, ${s.falseSplits} false` : "no data";
  });
  lines.push(`| ${d} | ${cells.join(" | ")} | ${pickTier(candidates)?.tier ?? "no pick"} |`);
}

const md = `${lines.join("\n")}\n`;
const out = join(workspace, "eval-results", "tiers");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.md"), md);
console.log(md);
console.log(`Wrote ${relative(process.cwd(), join(out, "report.md"))}`);
