import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrationsFolder } from "./migrate";

/** A fresh in-memory database with all migrations applied. For tests only. */
export async function createMemoryDb(): Promise<{
  db: PgliteDatabase;
  close(): Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
