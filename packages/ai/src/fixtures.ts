import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Env } from "@forkcheck/config";
import type {
  ModelCallInfo,
  ModelMessage,
  ModelPort,
  ModelRequest,
  ModelResponse,
  ReasoningEffort,
  StageName,
} from "./port";
import { workspaceRoot } from "./workspace";

export const defaultFixturesDir = join(workspaceRoot, "packages", "ai", "fixtures");

export interface FixtureKey {
  stage: StageName;
  promptVersion: string;
  hash: string;
}

/** The part of a request that determines the response. The Zod schema is fixed per stage and prompt version. */
export interface FixtureInput {
  messages: readonly ModelMessage[];
  reasoningEffort: ReasoningEffort;
}

export interface FixtureFile {
  key: FixtureKey;
  request: FixtureInput;
  output: unknown;
  recorded: Pick<
    ModelCallInfo,
    "provider" | "model" | "inputTokens" | "outputTokens" | "reasoningTokens"
  >;
}

/** JSON with object keys sorted at every level, so equal values always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries);
  });
}

export function fixtureInput(request: ModelRequest<unknown>): FixtureInput {
  return {
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    reasoningEffort: request.reasoningEffort,
  };
}

export function fixtureKey(request: ModelRequest<unknown>): FixtureKey {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(request.promptVersion)) {
    throw new Error(`promptVersion "${request.promptVersion}" cannot be used in a fixture path`);
  }
  const hash = createHash("sha256")
    .update(canonicalJson(fixtureInput(request)))
    .digest("hex");
  return { stage: request.stage, promptVersion: request.promptVersion, hash };
}

export function fixturePath(dir: string, key: FixtureKey): string {
  return join(dir, key.stage, key.promptVersion, `${key.hash}.json`);
}

export class MissingFixtureError extends Error {
  readonly key: FixtureKey;
  readonly path: string;

  constructor(key: FixtureKey, path: string) {
    super(
      `No fixture for stage=${key.stage} promptVersion=${key.promptVersion} hash=${key.hash} ` +
        `(expected ${path}). Record it with LIVE=1 RECORD_FIXTURES=1.`,
    );
    this.name = "MissingFixtureError";
    this.key = key;
    this.path = path;
  }
}

/** Replays recorded responses. Makes no network calls and costs nothing. */
export class FakeProvider implements ModelPort {
  readonly #dir: string;

  constructor(dir: string = defaultFixturesDir) {
    this.#dir = dir;
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const key = fixtureKey(request);
    const path = fixturePath(this.#dir, key);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new MissingFixtureError(key, path);
      throw error;
    }

    const fixture = JSON.parse(text) as FixtureFile;
    const parsed = request.schema.safeParse(fixture.output);
    if (!parsed.success) {
      throw new Error(`Fixture ${path} no longer matches the ${key.stage} schema; re-record it`);
    }
    return {
      output: parsed.data,
      call: {
        stage: key.stage,
        provider: "fake",
        model: fixture.recorded.model,
        promptVersion: key.promptVersion,
        cacheHit: false,
        latencyMs: 0,
        inputTokens: fixture.recorded.inputTokens,
        outputTokens: fixture.recorded.outputTokens,
        reasoningTokens: fixture.recorded.reasoningTokens,
        costUsd: 0,
        ok: true,
        error: null,
      },
    };
  }
}

/** Passes calls to a live provider and saves each successful response as a fixture. */
export class RecordingProvider implements ModelPort {
  readonly #live: ModelPort;
  readonly #dir: string;

  constructor(live: ModelPort, dir: string = defaultFixturesDir) {
    this.#live = live;
    this.#dir = dir;
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const key = fixtureKey(request);
    const response = await this.#live.call(request);
    const { provider, model, inputTokens, outputTokens, reasoningTokens } = response.call;
    const fixture: FixtureFile = {
      key,
      request: fixtureInput(request),
      output: response.output,
      recorded: { provider, model, inputTokens, outputTokens, reasoningTokens },
    };
    const path = fixturePath(this.#dir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);
    return response;
  }
}

/**
 * Replays a recorded response when there is one and records a live one when there isn't, so
 * re-running a recording pass extends the fixtures instead of rewriting them with new replies.
 */
export class RecordMissingProvider implements ModelPort {
  readonly #replay: FakeProvider;
  readonly #record: RecordingProvider;

  constructor(live: ModelPort, dir: string = defaultFixturesDir) {
    this.#replay = new FakeProvider(dir);
    this.#record = new RecordingProvider(live, dir);
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    try {
      return await this.#replay.call(request);
    } catch (error) {
      if (error instanceof MissingFixtureError) return this.#record.call(request);
      throw error;
    }
  }
}

/**
 * The provider to use when no live calls are wanted: replay by default, or record through
 * `live` when RECORD_FIXTURES=1 (which loadEnv only allows together with LIVE=1).
 */
export function fixtureProvider(
  env: Pick<Env, "RECORD_FIXTURES">,
  live: ModelPort | null,
  dir: string = defaultFixturesDir,
): ModelPort {
  if (!env.RECORD_FIXTURES) return new FakeProvider(dir);
  if (!live) throw new Error("RECORD_FIXTURES=1 needs a live provider to record from");
  return new RecordingProvider(live, dir);
}
