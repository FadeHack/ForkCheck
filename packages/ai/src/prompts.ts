import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StageName } from "./port";

export const defaultPromptsDir = fileURLToPath(new URL("../../../prompts/", import.meta.url));

export interface Prompt {
  /** Logged with every call, e.g. `extract.v1`. */
  version: string;
  text: string;
}

const loaded = new Map<string, Prompt>();

// A leading HTML comment holds license and attribution notes; the model never sees it.
const HEADER = /^\s*<!--[\s\S]*?-->/;

/** Prompts a stage uses besides its own, e.g. tier T1 options under `generateProbes`. */
export type PromptVariant = "generateProbesAssisted";

/** Reads `prompts/<name>.v<N>.md`. Wording changes get a new version file, never an edit. */
export function loadPrompt(
  prompt: StageName | PromptVariant,
  version: number,
  dir = defaultPromptsDir,
): Prompt {
  const name = `${prompt}.v${version}`;
  const path = join(dir, `${name}.md`);
  let cached = loaded.get(path);
  if (!cached) {
    cached = { version: name, text: readFileSync(path, "utf8").replace(HEADER, "").trim() };
    loaded.set(path, cached);
  }
  return cached;
}
