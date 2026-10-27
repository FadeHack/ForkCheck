import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SpendProvider = "meta" | "baseten";

export interface SpendLedger {
  totalUsd(provider: SpendProvider): Promise<number>;
  add(provider: SpendProvider, usd: number): Promise<void>;
}

type LedgerData = Partial<Record<SpendProvider, { usd: number; calls: number }>>;

export class MemorySpendLedger implements SpendLedger {
  readonly data: LedgerData = {};

  async totalUsd(provider: SpendProvider): Promise<number> {
    return this.data[provider]?.usd ?? 0;
  }

  async add(provider: SpendProvider, usd: number): Promise<void> {
    const entry = this.data[provider] ?? { usd: 0, calls: 0 };
    this.data[provider] = { usd: entry.usd + usd, calls: entry.calls + 1 };
  }
}

/** Local running total in a JSON file, e.g. `var/spend.json`. Survives restarts; not shared across machines. */
export class FileSpendLedger implements SpendLedger {
  readonly #path: string;
  // Serializes read-modify-write so concurrent calls in one process never lose an update.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async #read(): Promise<LedgerData> {
    try {
      return JSON.parse(await readFile(this.#path, "utf8")) as LedgerData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async totalUsd(provider: SpendProvider): Promise<number> {
    await this.#queue;
    return (await this.#read())[provider]?.usd ?? 0;
  }

  add(provider: SpendProvider, usd: number): Promise<void> {
    const next = this.#queue.then(async () => {
      const data = await this.#read();
      const entry = data[provider] ?? { usd: 0, calls: 0 };
      data[provider] = { usd: entry.usd + usd, calls: entry.calls + 1 };
      await mkdir(dirname(this.#path), { recursive: true });
      const tmp = `${this.#path}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await rename(tmp, this.#path);
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }
}

export class SpendCapError extends Error {
  constructor(
    readonly provider: SpendProvider,
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(
      `${provider} spend $${spentUsd.toFixed(4)} has reached the $${capUsd} cap; ` +
        `ask the project owner before raising it.`,
    );
    this.name = "SpendCapError";
  }
}
