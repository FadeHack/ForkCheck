import { loadEnv } from "@forkcheck/config";
import { connect, MeetingRepo, RoundRepo, SplitRepo, type Db } from "@forkcheck/db";

export interface Deps {
  db: Db;
  meetings: MeetingRepo;
  rounds: RoundRepo;
  splits: SplitRepo;
  now(): Date;
}

export function createDeps(db: Db, now: () => Date = () => new Date()): Deps {
  return {
    db,
    meetings: new MeetingRepo(db),
    rounds: new RoundRepo(db),
    splits: new SplitRepo(db),
    now,
  };
}

let current: Deps | undefined;

/** One database connection per server process, opened on first use. */
export function getDeps(): Deps {
  if (current === undefined) {
    const env = loadEnv(process.env, { require: ["DATABASE_URL"] });
    current = createDeps(connect(env.DATABASE_URL!).db);
  }
  return current;
}

/** Tests swap in a PGlite-backed set. */
export function setDeps(deps: Deps | undefined): void {
  current = deps;
}
