import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./pglite";

describe("migrations on PGlite", () => {
  it("apply cleanly and leave a queryable database", async () => {
    const db = await createTestDb();
    const result = await db.execute<{ one: number }>(sql`select 1 as one`);
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  it("record the baseline migration", async () => {
    const db = await createTestDb();
    const result = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(result.rows).toEqual([{ count: 1 }]);
  });
});
