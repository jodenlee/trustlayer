import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../test-support/database";
import {
  RUNTIME_PERMISSIONS_SQL,
  sufficientRuntimePermissions,
  formatRuntimeError,
} from "../scripts/lib/runtime-permissions";
test("runtime diagnostics retain safe codes and never suggest replacing the runtime URI with owner credentials", () => {
  for (const code of ["42501", "28P01", "SELF_SIGNED_CERT_IN_CHAIN"]) {
    const result = formatRuntimeError({
      code,
      message: "secret-password-and-project-ref",
    });
    assert.match(result, new RegExp(code));
    assert.ok(!result.includes("secret-password-and-project-ref"));
    assert.ok(!result.includes("Use the database owner URI"));
  }
  assert.match(
    formatRuntimeError({ code: "42501" }),
    /do not replace DATABASE_URL with owner credentials/,
  );
});
test("runtime readiness accepts a restricted login and rejects owner/session or membership escalation", async () => {
  const database = await testDatabase();
  try {
    // The fixture uses SET ROLE with an owner session login.
    assert.equal(
      sufficientRuntimePermissions(
        (await database.db.query(RUNTIME_PERMISSIONS_SQL)).rows[0],
      ),
      false,
      "Owner credentials cannot be made safe by SET ROLE",
    );
    await database.pg.exec("RESET ROLE");
    assert.equal(
      sufficientRuntimePermissions(
        (await database.db.query(RUNTIME_PERMISSIONS_SQL)).rows[0],
      ),
      false,
    );
    await database.pg.exec(
      "CREATE ROLE unsafe_runtime LOGIN; GRANT trustlayer_server TO unsafe_runtime; GRANT postgres TO unsafe_runtime; SET SESSION AUTHORIZATION unsafe_runtime;",
    );
    assert.equal(
      sufficientRuntimePermissions(
        (await database.db.query(RUNTIME_PERMISSIONS_SQL)).rows[0],
      ),
      false,
      "A login able to SET ROLE to the owner must not pass readiness checks",
    );
  } finally {
    await database.pg.close();
  }
  // Avoid relying on embedded-engine session-authorization reset defaults.
  const restricted = await testDatabase();
  try {
    await restricted.pg.exec(
      "RESET ROLE; CREATE ROLE verified_runtime LOGIN INHERIT; GRANT trustlayer_server TO verified_runtime; SET SESSION AUTHORIZATION verified_runtime;",
    );
    assert.equal(
      sufficientRuntimePermissions(
        (await restricted.db.query(RUNTIME_PERMISSIONS_SQL)).rows[0],
      ),
      true,
    );
  } finally {
    await restricted.pg.close();
  }
});
