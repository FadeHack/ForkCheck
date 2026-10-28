import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

/** Any Drizzle Postgres database: postgres-js in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export function connect(databaseUrl: string): DbHandle {
  const client = postgres(databaseUrl, { onnotice: () => {} });
  return { db: drizzle(client), close: () => client.end() };
}

export const toIso = (d: Date): string => d.toISOString();
export const toIsoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());
