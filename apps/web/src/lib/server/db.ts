import type { Pool, PoolClient } from "pg";

export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(run: (sql: Sql) => Promise<T>): Promise<T>;
}
export function postgresDatabase(pool: Pool): Database {
  const adapter = (client: Pool | PoolClient): Sql => ({
    async query<T extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      const result = await client.query<T>(sql, values);
      return { rows: result.rows };
    },
  });
  return {
    ...adapter(pool),
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run(adapter(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
