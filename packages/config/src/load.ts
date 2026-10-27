import { envNames, envSchema, type Env, type EnvName } from "./schema";

export type EnvSource = Record<string, string | undefined>;

export interface EnvProblem {
  name: string;
  issue: string;
}

/** Lists problems by variable name only; values never appear in the message. */
export class EnvError extends Error {
  readonly problems: readonly EnvProblem[];

  constructor(problems: readonly EnvProblem[]) {
    super(`Environment: ${problems.map((p) => `${p.name} ${p.issue}`).join("; ")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

export interface LoadEnvOptions {
  /** Variables this caller needs even though the schema treats them as optional. */
  require?: readonly EnvName[];
}

export function loadEnv(source: EnvSource = process.env, options: LoadEnvOptions = {}): Env {
  const raw: Partial<Record<EnvName, string>> = {};
  for (const name of envNames) {
    const value = source[name];
    if (value !== undefined && value !== "") raw[name] = value;
  }

  const problems = new Map<string, string>();
  const missing = (name: EnvName, reason?: string) => {
    if (raw[name] === undefined && !problems.has(name)) {
      problems.set(name, reason ? `is missing (${reason})` : "is missing");
    }
  };

  if (raw.LIVE === "1") missing("MODEL_API_KEY", "required when LIVE=1");
  if (raw.STORAGE_DRIVER === "blob")
    missing("BLOB_READ_WRITE_TOKEN", "required when STORAGE_DRIVER=blob");
  for (const name of options.require ?? []) missing(name);

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? "environment");
      if (!problems.has(name)) problems.set(name, `is invalid: ${issue.message}`);
    }
  }

  if (problems.size > 0 || !result.success) {
    const list = [...problems].map(([name, issue]) => ({ name, issue }));
    throw new EnvError(list.sort((a, b) => a.name.localeCompare(b.name)));
  }
  return result.data;
}
