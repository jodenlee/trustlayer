import { readFile, readdir } from "node:fs/promises";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Database, Sql } from "../src/lib/server/db";

export async function testDatabase() {
  const pg = new PGlite();
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(dir))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(new URL(file, dir), "utf8"));
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
