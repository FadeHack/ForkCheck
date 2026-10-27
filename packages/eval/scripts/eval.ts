/**
 * Scenario tooling.
 * Usage: pnpm eval validate [scenario files...]   (default: every scenario under scenarios/)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lintScenario, scenario } from "../src/index";

const root = resolve(import.meta.dirname, "../../../scenarios");

function allScenarioFiles(): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json") && !f.startsWith("audio"))
    .sort()
    .map((f) => join(root, f));
}

function validate(files: string[]): boolean {
  let ok = true;
  for (const file of files) {
    const name = relative(process.cwd(), file);
    const problems: string[] = [];
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (problems.length === 0) {
      const parsed = scenario.safeParse(json);
      if (parsed.success) {
        for (const issue of lintScenario(parsed.data)) {
          problems.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      } else {
        for (const issue of parsed.error.issues) {
          problems.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    }
    if (problems.length === 0) {
      console.log(`ok    ${name}`);
    } else {
      ok = false;
      console.log(`FAIL  ${name}`);
      for (const p of problems) console.log(`      ${p}`);
    }
  }
  return ok;
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "validate": {
    const files = args.length > 0 ? args.map((f) => resolve(f)) : allScenarioFiles();
    process.exit(validate(files) ? 0 : 1);
    break;
  }
  default:
    console.error("Usage: pnpm eval validate [scenario files...]");
    process.exit(2);
}
