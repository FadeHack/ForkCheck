import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import type { EnvSource } from "./load";

export function findWorkspaceRoot(start: string = process.cwd()): string | undefined {
  let dir = start;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return dir;
}

/**
 * Copies variables from `<workspace root>/.env.local` into `target`, keeping any
 * value that is already set. Returns the file path, or undefined if there is no file.
 */
export function loadLocalEnvFile(
  target: EnvSource = process.env,
  root: string | undefined = findWorkspaceRoot(),
): string | undefined {
  if (root === undefined) return undefined;
  const file = join(root, ".env.local");
  if (!existsSync(file)) return undefined;

  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (target[name] === undefined && value !== undefined) target[name] = value;
  }
  return file;
}
