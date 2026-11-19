import { readFile } from "node:fs/promises";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Database, Sql } from "../src/lib/server/db";

export async function testDatabase() {
  const pg = new PGlite();
  await pg.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202611190001_phase4a.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec("SET ROLE trustlayer_server");
  const adapter = (sql: PGlite | Transaction): Sql => ({
    async query<T extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      const result = await sql.query<T>(text, values);
      return { rows: result.rows };
    },
  });
  const db: Database = {
    ...adapter(pg),
    transaction: (run) => pg.transaction((tx) => run(adapter(tx))),
  };
  return { pg, db };
}
