import { join } from "node:path";
import {
  ConsoleCallLog,
  FakeProvider,
  FileSpendLedger,
  MetaProvider,
  MultiCallLog,
  type ModelPort,
} from "@forkcheck/ai";
import { findWorkspaceRoot, loadEnv, type Env } from "@forkcheck/config";
import { parseProbeDimensions, type Dimension } from "@forkcheck/core";
import { connect, DbCallLog, MeetingRepo, RoundRepo, SplitRepo, type Db } from "@forkcheck/db";

/** Stored audio. The local-disk and Blob implementations arrive with uploads. */
export interface Storage {
  delete(key: string): Promise<void>;
}

export const noStorage: Storage = { delete: async () => {} };

export interface Deps {
  db: Db;
  meetings: MeetingRepo;
  rounds: RoundRepo;
  splits: SplitRepo;
  storage: Storage;
  /** The model for one meeting's requests; its calls are logged against that meeting. */
  model(meetingId: string): ModelPort;
  /** PROBE_DIMENSIONS, parsed. */
  dimensions: readonly Dimension[];
  now(): Date;
}

export type DepsOverrides = Partial<Pick<Deps, "storage" | "model" | "dimensions" | "now">>;

export function createDeps(db: Db, overrides: DepsOverrides = {}): Deps {
  return {
    db,
    meetings: new MeetingRepo(db),
    rounds: new RoundRepo(db),
    splits: new SplitRepo(db),
    storage: noStorage,
    model: () => new FakeProvider(),
    dimensions: parseProbeDimensions(undefined),
    now: () => new Date(),
    ...overrides,
  };
}

/** Recorded fixtures unless LIVE=1; live calls share the CLI's spend ledger and cap. */
function modelFactory(env: Env, db: Db): (meetingId: string) => ModelPort {
  if (!env.LIVE) return () => new FakeProvider();
  const root = findWorkspaceRoot() ?? process.cwd();
  const ledger = new FileSpendLedger(join(root, "var", "spend.json"));
  return (meetingId) =>
    new MetaProvider({
      apiKey: env.MODEL_API_KEY ?? "",
      spendCapUsd: env.SPEND_CAP_USD,
      ledger,
      log: new MultiCallLog(new ConsoleCallLog(), new DbCallLog(db, { meetingId })),
    });
}

let current: Deps | undefined;

/** One database connection per server process, opened on first use. */
export function getDeps(): Deps {
  if (current === undefined) {
    const env = loadEnv(process.env, { require: ["DATABASE_URL"] });
    const { db } = connect(env.DATABASE_URL!);
    current = createDeps(db, {
      model: modelFactory(env, db),
      dimensions: parseProbeDimensions(env.PROBE_DIMENSIONS),
    });
  }
  return current;
}

/** Tests swap in a PGlite-backed set. */
export function setDeps(deps: Deps | undefined): void {
  current = deps;
}
