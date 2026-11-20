import { Pool } from "pg";
import { databaseConfig } from "../src/lib/server/config";
import {
  RUNTIME_PERMISSIONS_SQL,
  sufficientRuntimePermissions,
  formatRuntimeError,
} from "./lib/runtime-permissions";

const pool = new Pool(databaseConfig());
pool.on("error", (error) => console.error(formatRuntimeError(error)));
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    console.log(
      `SELECT 1: ${(await client.query("SELECT 1 AS ok")).rows[0]?.ok === 1 ? "passed" : "failed"}`,
    );
    const sufficient = sufficientRuntimePermissions(
      (await client.query(RUNTIME_PERMISSIONS_SQL)).rows[0],
    );
    console.log(
      `Restricted runtime-role permissions: ${sufficient ? "passed" : "not configured"}. Connection values and role identifiers are hidden.`,
    );
    await client.query("ROLLBACK");
    if (!sufficient) {
      console.log(
        "Preserve the working configuration. Follow the manual role separation procedure in docs/PHASE5.md, then verify the candidate URI before replacing DATABASE_URL.",
      );
      process.exitCode = 1;
    }
  } finally {
    client.release();
  }
} catch (error) {
  console.error(formatRuntimeError(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
