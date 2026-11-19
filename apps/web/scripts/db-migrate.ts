import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  migrationConnection,
  formatMigrationError,
  MigrationError,
  OWNER_PERMISSIONS_SQL,
  sufficientOwnerPermissions,
  type OwnerPermissions,
} from "./lib/migration-diagnostics";

// No reset/drop command: migrations must be explicitly pointed at a database.
let pool: Pool | undefined;
let client: PoolClient | undefined;
let locked = false;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new MigrationError("INVALID_ARGUMENT");
  const { source, config } = migrationConnection();
  console.log(
    `Migration connection source: ${source}. Environment values are hidden.`,
  );
  if (source === "DATABASE_URL")
    console.log(
      "DATABASE_MIGRATION_URL is not set; using the legacy DATABASE_URL fallback. Prefer a separate owner URI for migrations.",
    );
  pool = new Pool(config);
  pool.on("error", (error) => console.error(formatMigrationError(error)));
  client = await pool.connect();
  if ((await client.query("SELECT 1 AS ok")).rows[0]?.ok !== 1)
    throw new Error();
  console.log("SELECT 1 succeeded; database authentication succeeded.");
  const permissions = (
    await client.query<OwnerPermissions>(OWNER_PERMISSIONS_SQL)
  ).rows[0];
  console.log(
    `Owner permissions sufficient: ${sufficientOwnerPermissions(permissions) ? "yes" : "no"}.`,
  );
  if (!sufficientOwnerPermissions(permissions))
    throw new MigrationError("OWNER_PERMISSIONS_REQUIRED");
  if (args[0] === "--check") {
    console.log(
      "Read-only connection/permission check passed. No migrations applied.",
    );
  } else {
    await client.query("SELECT pg_advisory_lock(436131337)");
    locked = true;
    await client.query(
      "CREATE TABLE IF NOT EXISTS public.trustlayer_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    await client.query(
      "REVOKE ALL ON public.trustlayer_schema_migrations FROM PUBLIC",
    );
    const dir = path.resolve(
      import.meta.dirname,
      "../../../supabase/migrations",
    );
    for (const name of (await readdir(dir))
      .filter((n) => /^\d+_[a-z0-9_]+\.sql$/.test(n))
      .sort()) {
      const sql = await readFile(path.join(dir, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM public.trustlayer_schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new MigrationError("MIGRATION_CHECKSUM_MISMATCH");
        console.log(`SKIP ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.trustlayer_schema_migrations(name,checksum) VALUES ($1,$2)",
          [name, checksum],
        );
        await client.query("COMMIT");
        console.log(`APPLIED ${name}`);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* Preserve the original diagnostic, not a cleanup error. */
        }
        throw error;
      }
    }
  }
} catch (error) {
  console.error(formatMigrationError(error));
  process.exitCode = 1;
} finally {
  if (client) {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(436131337)");
      } catch (error) {
        console.error(formatMigrationError(error));
        process.exitCode = 1;
      }
    }
    client.release();
  }
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      console.error(formatMigrationError(error));
      process.exitCode = 1;
    }
  }
}
