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

/** Reads `prompts/<stage>.v<N>.md`. Wording changes get a new version file, never an edit. */
export function loadPrompt(stage: StageName, version: number, dir = defaultPromptsDir): Prompt {
  const name = `${stage}.v${version}`;
  const path = join(dir, `${name}.md`);
  let prompt = loaded.get(path);
  if (!prompt) {
    prompt = { version: name, text: readFileSync(path, "utf8").trim() };
    loaded.set(path, prompt);
  }
  return prompt;
}
