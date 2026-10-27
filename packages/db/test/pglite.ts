import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll } from "vitest";
import { migrationsFolder } from "../src/index";

/** A fresh in-memory database with all migrations applied, closed when the test file ends. */
export async function createTestDb(): Promise<PgliteDatabase> {
  const client = new PGlite();
  afterAll(() => client.close());
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder });
  return db;
}
