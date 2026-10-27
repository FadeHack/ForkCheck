import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fixturePath, type FixtureKey } from "./fixtures";

/** Development cache keyed by (stage, promptVersion, input hash). Never used in eval runs. */
export interface ModelCache {
  get(key: FixtureKey): Promise<unknown>;
  set(key: FixtureKey, output: unknown): Promise<void>;
}

export class MemoryModelCache implements ModelCache {
  readonly #entries = new Map<string, unknown>();
  #id = (k: FixtureKey) => `${k.stage}/${k.promptVersion}/${k.hash}`;

  async get(key: FixtureKey): Promise<unknown> {
    return this.#entries.get(this.#id(key));
  }

  async set(key: FixtureKey, output: unknown): Promise<void> {
    this.#entries.set(this.#id(key), output);
  }
}

/** Stores outputs under `dir` (e.g. `var/model-cache`) in the fixture layout. */
export class FileModelCache implements ModelCache {
  constructor(readonly dir: string) {}

  async get(key: FixtureKey): Promise<unknown> {
    try {
      return JSON.parse(await readFile(fixturePath(this.dir, key), "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async set(key: FixtureKey, output: unknown): Promise<void> {
    const path = fixturePath(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`);
  }
}
