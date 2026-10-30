import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ConsoleCallLog,
  FakeProvider,
  FileSpendLedger,
  LoggedProvider,
  MetaProvider,
  MultiCallLog,
  type ModelPort,
} from "@forkcheck/ai";
import {
  RecordingTranscriber,
  ReplayTranscriber,
  TranscribeClient,
  type Transcriber,
} from "@forkcheck/asr";
import { findWorkspaceRoot, loadEnv, type Env } from "@forkcheck/config";
import { parseProbeDimensions, type Dimension } from "@forkcheck/core";
import { connect, DbCallLog, MeetingRepo, RoundRepo, SplitRepo, type Db } from "@forkcheck/db";
import { logError } from "./log";
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

/** Recorded fixtures unless LIVE=1; live calls share the CLI's spend ledger and cap. */
function modelFactory(env: Env, db: Db, ledger: FileSpendLedger): (meetingId: string) => ModelPort {
  // Replays are logged too, so the trace panel shows a replayed demo's calls.
  if (!env.LIVE) {
    return (meetingId) => new LoggedProvider(new FakeProvider(), new DbCallLog(db, { meetingId }));
  }
  return (meetingId) =>
    new MetaProvider({
      apiKey: env.MODEL_API_KEY ?? "",
      spendCapUsd: env.SPEND_CAP_USD,
      ledger,
      log: new MultiCallLog(new ConsoleCallLog(), new DbCallLog(db, { meetingId })),
    });
}

/** Live transcriptions bill the same ledger and cap as model calls; RECORD_FIXTURES=1 saves them for replay. */
function transcriberFactory(env: Env, ledger: FileSpendLedger): () => Transcriber {
  if (!env.LIVE) return () => new ReplayTranscriber(replayDir());
  const logPath = join(workspace(), "var", "transcribe-calls.jsonl");
  return () => {
    const client = new TranscribeClient({
      apiKey: env.MODEL_API_KEY ?? "",
      spendCapUsd: env.SPEND_CAP_USD,
      ledger,
      log: {
        async write(entry) {
          await mkdir(join(workspace(), "var"), { recursive: true });
          await appendFile(logPath, `${JSON.stringify(entry)}\n`);
        },
      },
    });
    return env.RECORD_FIXTURES ? new RecordingTranscriber(client, replayDir()) : client;
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
      model: modelFactory(env, db, ledger),
      transcriber: transcriberFactory(env, ledger),
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
