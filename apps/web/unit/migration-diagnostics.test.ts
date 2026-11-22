import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMigrationError,
  formatMigrationError,
  migrationConnection,
  MigrationError,
  sufficientOwnerPermissions,
  OWNER_PERMISSIONS_SQL,
} from "../scripts/lib/migration-diagnostics";
import { testDatabase } from "../test-support/database";

describe("safe migration diagnostics", () => {
  it("executes the read-only permission query for both owner and runtime roles", async () => {
    const { pg, db } = await testDatabase();
    try {
      const runtime = (await db.query(OWNER_PERMISSIONS_SQL)).rows[0];
      assert.equal(runtime.can_create_roles, false);
      await pg.exec("RESET ROLE");
      assert.deepEqual((await db.query(OWNER_PERMISSIONS_SQL)).rows[0], {
        can_create_roles: true,
        can_create_schema: true,
        can_use_public_schema: true,
        owns_existing_history: true,
      });
    } finally {
      await pg.close();
    }
  });
  for (const [code, category] of [
    ["28P01", "database authentication"],
    ["42501", "insufficient privileges"],
    ["3D000", "database missing"],
    ["ENOTFOUND", "DNS failure"],
    ["ETIMEDOUT", "connection timeout"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "TLS certificate validation"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS hostname validation"],
    ["ERR_OSSL_PEM_NO_START_LINE", "TLS CA configuration"],
    ["42P06", "migration/schema conflict"],
    ["42P07", "migration/schema conflict"],
    ["42710", "migration/schema conflict"],
  ])
    it(`classifies ${code} without logging details`, () => {
      const error = {
        code,
        message:
          "postgresql://private_identifier:secret_password@hidden.example/db",
        detail: "sensitive SQL value",
        stack: "private stack",
        username: "private_identifier",
      };
      assert.equal(classifyMigrationError(error).category, category);
      assert.equal(classifyMigrationError(error).code, code);
      const formatted = formatMigrationError(error);
      for (const secret of [
        "postgresql://",
        "private_identifier",
        "secret_password",
        "hidden.example",
        "sensitive SQL value",
        "private stack",
      ])
        assert.equal(formatted.includes(secret), false);
    });
  it("handles checksums and privilege preflight with explicit application codes", () => {
    assert.equal(
      classifyMigrationError(new MigrationError("MIGRATION_CHECKSUM_MISMATCH"))
        .category,
      "migration checksum mismatch",
    );
    assert.equal(
      classifyMigrationError(new MigrationError("OWNER_PERMISSIONS_REQUIRED"))
        .code,
      "OWNER_PERMISSIONS_REQUIRED",
    );
  });
  it("recognizes pg timeouts with no code without exposing their message", () => {
    assert.equal(
      classifyMigrationError(
        new Error("Connection terminated due to connection timeout SECRET"),
      ).code,
      "PG_CONNECTION_TIMEOUT",
    );
    assert.doesNotMatch(
      formatMigrationError(
        new Error("Connection terminated due to connection timeout SECRET"),
      ),
      /SECRET/,
    );
  });
  it("traverses aggregate errors/causes and tolerates cycles", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    assert.equal(
      classifyMigrationError(
        new AggregateError([
          cyclic,
          { cause: { code: "ENOTFOUND", message: "private host" } },
        ]),
      ).code,
      "ENOTFOUND",
    );
    assert.equal(classifyMigrationError(cyclic).code, "UNCLASSIFIED");
  });
  it("never prints arbitrary error codes, stacks or thrown strings", () => {
    for (const error of [
      { code: "postgres.owner_identifier:SECRET", message: "secret" },
      "secret string",
      null,
      { message: "secret", stack: "secret" },
    ]) {
      assert.equal(classifyMigrationError(error).code, "UNCLASSIFIED");
      assert.doesNotMatch(
        formatMigrationError(error),
        /SECRET|secret string|owner_identifier/,
      );
    }
  });
  it("prefers the migration URI and preserves safe TLS and trusted CA configuration", () => {
    const owner = "postgresql://owner:example@pooler.example:5432/postgres";
    const result = migrationConnection({
      DATABASE_MIGRATION_URL: owner,
      DATABASE_URL: "invalid runtime URI",
      DATABASE_CA_CERT: "PEM\\nLINES",
    });
    assert.equal(result.source, "DATABASE_MIGRATION_URL");
    assert.equal(result.config.connectionString, owner);
    assert.deepEqual(result.config.ssl, {
      rejectUnauthorized: true,
      ca: "PEM\nLINES",
    });
    assert.equal(
      migrationConnection({ DATABASE_URL: owner }).source,
      "DATABASE_URL",
    );
    assert.throws(() =>
      migrationConnection({ DATABASE_MIGRATION_URL: "", DATABASE_URL: owner }),
    );
  });
  it("reports invalid URI/SSL URL configuration without printing the URI", () => {
    for (const uri of [
      "INVALID_SECRET_URI",
      "postgresql://user:SECRET@db.example/app?sslmode=disable",
    ]) {
      try {
        migrationConnection({ DATABASE_MIGRATION_URL: uri });
        assert.fail("Expected validation error");
      } catch (error) {
        assert.equal(
          classifyMigrationError(error).category,
          "database configuration",
        );
        assert.doesNotMatch(
          formatMigrationError(error),
          /SECRET|user:|db\.example/,
        );
      }
    }
  });
  it("requires all owner capabilities before considering permission checks sufficient", () => {
    const ok = {
      can_create_roles: true,
      can_create_schema: true,
      can_use_public_schema: true,
      owns_existing_history: true,
    };
    assert.equal(sufficientOwnerPermissions(ok), true);
    for (const key of Object.keys(ok))
      assert.equal(sufficientOwnerPermissions({ ...ok, [key]: false }), false);
    assert.equal(sufficientOwnerPermissions(undefined), false);
  });
});
