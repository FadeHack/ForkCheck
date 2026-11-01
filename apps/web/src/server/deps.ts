import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ConsoleCallLog,
  FakeProvider,
  FallbackProvider,
  FileSpendLedger,
  LoggedProvider,
  MetaProvider,
  MultiCallLog,
  RecordMissingProvider,
  type ModelPort,
  type SpendLedger,
} from "@forkcheck/ai";
import {
  FallbackTranscriber,
  RecordingTranscriber,
  ReplayTranscriber,
  TranscribeClient,
  type Transcriber,
} from "@forkcheck/asr";
import { findWorkspaceRoot, loadEnv, type Env } from "@forkcheck/config";
import { parseProbeDimensions, type Dimension } from "@forkcheck/core";
import { connect, DbCallLog, MeetingRepo, RoundRepo, SplitRepo, type Db } from "@forkcheck/db";
import { logError } from "./log";
import { MeetingScopedProvider } from "./meeting-scope";
import { LocalDiskStorage, type Storage } from "./storage";

/** For deps without audio: nothing is stored, so there is nothing to read or delete. */
export const noStorage: Storage = {
  put: async () => {
    throw new Error("No audio storage is configured");
  },
  get: async () => null,
  delete: async () => {},
};

export interface Deps {
  db: Db;
  meetings: MeetingRepo;
  rounds: RoundRepo;
  splits: SplitRepo;
  storage: Storage;
  /** The model for one meeting's requests; its calls are logged against that meeting. */
  model(meetingId: string): ModelPort;
  /** Voice Transcribe for one meeting's recording: live with LIVE=1, recorded responses otherwise. */
  transcriber(meetingId: string): Transcriber;
  ffmpegPath: string;
  /** Runs work after the response is sent; tests replace it to await the work. */
  background(task: () => Promise<void>): void;
  /** PROBE_DIMENSIONS, parsed. */
  dimensions: readonly Dimension[];
  now(): Date;
}

export type DepsOverrides = Partial<
  Pick<
    Deps,
    "storage" | "model" | "transcriber" | "ffmpegPath" | "background" | "dimensions" | "now"
  >
>;

const workspace = () => findWorkspaceRoot() ?? process.cwd();
const replayDir = () => join(workspace(), "packages", "asr", "fixtures", "replay");

export function createDeps(db: Db, overrides: DepsOverrides = {}): Deps {
  return {
    db,
    meetings: new MeetingRepo(db),
    rounds: new RoundRepo(db),
    splits: new SplitRepo(db),
    storage: noStorage,
    model: () => new FakeProvider(),
    transcriber: () => new ReplayTranscriber(replayDir()),
    ffmpegPath: "ffmpeg",
    background: (task) => {
      task().catch((error: unknown) => logError("background task", error));
    },
    dimensions: parseProbeDimensions(undefined),
    now: () => new Date(),
    ...overrides,
  };
}

/** What the live factories need; tests pass a `fetch` that fails, to stand in for a dead network. */
export interface LiveOptions {
  env: Pick<Env, "LIVE" | "RECORD_FIXTURES" | "MODEL_API_KEY" | "SPEND_CAP_USD">;
  db: Db;
  ledger: SpendLedger;
  fetch?: typeof fetch;
  /** Skips the retry waits in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Where recorded transcriptions are kept; the repository's by default. */
  replayDir?: string;
}

/**
 * Recorded fixtures unless LIVE=1. Live calls share the CLI's spend ledger and cap, and fall
 * back to a recorded reply when the service can't be reached; RECORD_FIXTURES=1 records the
 * ones missing. Every replay is logged as `fake`, so the trace and the screens can label it.
 */
export function modelFactory(o: LiveOptions): (meetingId: string) => ModelPort {
  const replay = (meetingId: string) =>
    new LoggedProvider(new FakeProvider(), new DbCallLog(o.db, { meetingId }));
  if (!o.env.LIVE) return (meetingId) => new MeetingScopedProvider(replay(meetingId), meetingId);
  return (meetingId) => {
    const meta = new MetaProvider({
      apiKey: o.env.MODEL_API_KEY ?? "",
      spendCapUsd: o.env.SPEND_CAP_USD,
      ledger: o.ledger,
      log: new MultiCallLog(new ConsoleCallLog(), new DbCallLog(o.db, { meetingId })),
      ...(o.fetch ? { fetch: o.fetch } : {}),
      ...(o.sleep ? { sleep: o.sleep } : {}),
    });
    const live = o.env.RECORD_FIXTURES ? new RecordMissingProvider(meta) : meta;
    return new MeetingScopedProvider(new FallbackProvider(live, replay(meetingId)), meetingId);
  };
}

/**
 * Recorded responses unless LIVE=1. Live transcriptions bill the same ledger and cap as model
 * calls and fall back to the recording when the service can't be reached; RECORD_FIXTURES=1
 * saves them for replay.
 */
export function transcriberFactory(o: LiveOptions): () => Transcriber {
  const dir = o.replayDir ?? replayDir();
  if (!o.env.LIVE) return () => new ReplayTranscriber(dir);
  const logPath = join(workspace(), "var", "transcribe-calls.jsonl");
  return () => {
    const client = new TranscribeClient({
      apiKey: o.env.MODEL_API_KEY ?? "",
      spendCapUsd: o.env.SPEND_CAP_USD,
      ledger: o.ledger,
      log: {
        async write(entry) {
          await mkdir(join(workspace(), "var"), { recursive: true });
          await appendFile(logPath, `${JSON.stringify(entry)}\n`);
        },
      },
      ...(o.fetch ? { fetch: o.fetch } : {}),
      ...(o.sleep ? { sleep: o.sleep } : {}),
    });
    const live = o.env.RECORD_FIXTURES ? new RecordingTranscriber(client, dir) : client;
    return new FallbackTranscriber(live, new ReplayTranscriber(dir));
  };
}

/** Vercel Blob is wired only if the app is deployed; local runs keep audio under AUDIO_DIR. */
function storageFor(env: Env): Storage {
  if (env.STORAGE_DRIVER === "blob") {
    throw new Error("STORAGE_DRIVER=blob is not available yet; use STORAGE_DRIVER=local");
  }
  return new LocalDiskStorage(resolve(workspace(), env.AUDIO_DIR));
}

let current: Deps | undefined;

/** One database connection per server process, opened on first use. */
export function getDeps(): Deps {
  if (current === undefined) {
    const env = loadEnv(process.env, { require: ["DATABASE_URL"] });
    const { db } = connect(env.DATABASE_URL!);
    const ledger = new FileSpendLedger(join(workspace(), "var", "spend.json"));
    current = createDeps(db, {
      model: modelFactory({ env, db, ledger }),
      transcriber: transcriberFactory({ env, db, ledger }),
      ffmpegPath: env.FFMPEG_PATH,
      storage: storageFor(env),
      dimensions: parseProbeDimensions(env.PROBE_DIMENSIONS),
    });
  }
  return current;
}

/** Tests swap in a PGlite-backed set. */
export function setDeps(deps: Deps | undefined): void {
  current = deps;
}
