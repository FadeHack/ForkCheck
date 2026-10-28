import { afterAll } from "vitest";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { createMemoryDb } from "../src/testing";

/** A fresh in-memory database with all migrations applied, closed when the test file ends. */
export async function createTestDb(): Promise<PgliteDatabase> {
  const { db, close } = await createMemoryDb();
  afterAll(close);
  return db;
}
