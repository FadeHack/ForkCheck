import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ModelCallInfo, ModelPort, ModelRequest, ModelResponse } from "./port";

/** A logged call. Never carries message content, keys or tokens. */
export interface ModelCallEntry extends ModelCallInfo {
  at: string;
}

export interface ModelCallLog {
  write(entry: ModelCallEntry): Promise<void>;
}

export class MemoryCallLog implements ModelCallLog {
  readonly entries: ModelCallEntry[] = [];

  async write(entry: ModelCallEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export class ConsoleCallLog implements ModelCallLog {
  async write(e: ModelCallEntry): Promise<void> {
    const status = e.ok ? "ok" : `FAILED ${e.error ?? ""}`;
    console.error(
      `[model] ${e.stage} ${e.provider}/${e.model} ${e.promptVersion} ${status}` +
        `${e.cacheHit ? " (cache)" : ""} ${e.latencyMs}ms in=${e.inputTokens} out=${e.outputTokens}` +
        ` reasoning=${e.reasoningTokens ?? "n/a"} $${e.costUsd.toFixed(5)}`,
    );
  }
}

/** One JSON object per line, e.g. `var/model-calls.jsonl`. */
export class FileCallLog implements ModelCallLog {
  constructor(readonly path: string) {}

  async write(entry: ModelCallEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`);
  }
}

export class MultiCallLog implements ModelCallLog {
  readonly #logs: readonly ModelCallLog[];

  constructor(...logs: ModelCallLog[]) {
    this.#logs = logs;
  }

  async write(entry: ModelCallEntry): Promise<void> {
    await Promise.all(this.#logs.map((l) => l.write(entry)));
  }
}

/** Logs every call another port makes. Replays have no log of their own, so this gives them one. */
export class LoggedProvider implements ModelPort {
  readonly #inner: ModelPort;
  readonly #log: ModelCallLog;
  readonly #now: () => Date;

  constructor(inner: ModelPort, log: ModelCallLog, now: () => Date = () => new Date()) {
    this.#inner = inner;
    this.#log = log;
    this.#now = now;
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const response = await this.#inner.call(request);
    await this.#log.write({ ...response.call, at: this.#now().toISOString() });
    return response;
  }
}
