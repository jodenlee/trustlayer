import { databaseConfig } from "../../src/lib/server/config";

export class MigrationError extends Error {
  constructor(
    readonly code:
      | "MIGRATION_CHECKSUM_MISMATCH"
      | "OWNER_PERMISSIONS_REQUIRED"
      | "INVALID_ARGUMENT",
  ) {
    super(code);
  }
}

/** Keep the existing precedence, including explicit empty values (which fail validation). */
export function migrationConnection(
  env: Record<string, string | undefined> = process.env,
) {
  const source =
    env.DATABASE_MIGRATION_URL !== undefined
      ? "DATABASE_MIGRATION_URL"
      : "DATABASE_URL";
  return {
    source,
    config: databaseConfig({ ...env, DATABASE_URL: env[source] }),
  };
}

const guidance = {
  "28P01": [
    "database authentication",
    "Verify the database password and Session Pooler owner username in DATABASE_MIGRATION_URL. URL-encode the actual password; omit template brackets unless they belong to the password.",
  ],
  "42501": [
    "insufficient privileges",
    "Use the database owner URI in DATABASE_MIGRATION_URL, not the restricted runtime login. Check CREATE ROLE, database/schema creation and existing object ownership.",
  ],
  "3D000": [
    "database missing",
    "Copy the database name from Supabase's Session Pooler URI; do not create or reset a database to suppress this error.",
  ],
  ENOTFOUND: [
    "DNS failure",
    "Verify the Session Pooler hostname locally and check DNS/VPN connectivity.",
  ],
  EAI_AGAIN: ["DNS failure", "Retry after checking DNS/VPN connectivity."],
  ETIMEDOUT: [
    "connection timeout",
    "Check pooler availability, port 5432, firewall/VPN and Supabase network restrictions.",
  ],
  ECONNREFUSED: [
    "connection refused",
    "Check the configured pooler endpoint/port and service availability.",
  ],
  ECONNRESET: [
    "connection interrupted",
    "Check network/VPN, pooler availability and TLS configuration before retrying.",
  ],
  EHOSTUNREACH: [
    "network unreachable",
    "Check routing, firewall and VPN connectivity.",
  ],
  SELF_SIGNED_CERT_IN_CHAIN: [
    "TLS certificate validation",
    "Configure DATABASE_CA_CERT with the trusted Supabase database CA PEM from the dashboard (literal \\n supported). Keep certificate verification enabled.",
  ],
  DEPTH_ZERO_SELF_SIGNED_CERT: [
    "TLS certificate validation",
    "Configure the correct trusted database CA in DATABASE_CA_CERT; do not disable certificate verification.",
  ],
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: [
    "TLS certificate validation",
    "Supply the trusted database CA/certificate chain in DATABASE_CA_CERT.",
  ],
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: [
    "TLS certificate validation",
    "Supply the trusted database CA in DATABASE_CA_CERT.",
  ],
  UNABLE_TO_GET_ISSUER_CERT: [
    "TLS certificate validation",
    "Supply the complete trusted database CA chain in DATABASE_CA_CERT.",
  ],
  CERT_HAS_EXPIRED: [
    "TLS certificate validation",
    "Check the system clock and renew/download the current trusted database certificate.",
  ],
  CERT_NOT_YET_VALID: [
    "TLS certificate validation",
    "Check the system clock and the database certificate validity period.",
  ],
  ERR_TLS_CERT_ALTNAME_INVALID: [
    "TLS hostname validation",
    "Use the exact Supabase hostname matching the certificate; do not disable hostname verification.",
  ],
  ERR_OSSL_PEM_NO_START_LINE: [
    "TLS CA configuration",
    "Set DATABASE_CA_CERT to PEM certificate contents, not a file path; use literal \\n for line breaks.",
  ],
  "42P06": [
    "migration/schema conflict",
    "The schema already exists. Inspect migration history and existing objects; do not reset or drop the schema.",
  ],
  "42P07": [
    "migration/schema conflict",
    "A migration table/object already exists. Inspect migration history; do not reset the database.",
  ],
  "42710": [
    "migration/schema conflict",
    "A role/type/object already exists. Inspect migration history and ownership before making changes.",
  ],
  "23505": [
    "migration/history conflict",
    "Inspect duplicate migration history or existing records without deleting data.",
  ],
  backend_setup: [
    "database configuration",
    "Set DATABASE_MIGRATION_URL to a valid owner PostgreSQL URI. Remove ssl URL parameters; use DATABASE_CA_CERT for an explicit trusted CA.",
  ],
  MIGRATION_CHECKSUM_MISMATCH: [
    "migration checksum mismatch",
    "Restore the applied migration's original contents and add a new migration for changes. Do not edit checksums or reset the schema.",
  ],
  OWNER_PERMISSIONS_REQUIRED: [
    "insufficient owner permissions",
    "Use a migration-owner URI with CREATE ROLE, database CREATE, public schema CREATE/USAGE and ownership of any existing migration-history table.",
  ],
  INVALID_ARGUMENT: [
    "command arguments",
    "Use db:migrate with no arguments to apply migrations, or append -- --check for a read-only connection/permission check.",
  ],
} as const;

export interface SafeMigrationFailure {
  category: string;
  code: string;
  fix: string;
}
/** No error message, stack, SQL, identifier or arbitrary code is ever returned. */
export function classifyMigrationError(error: unknown): SafeMigrationFailure {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  let timeout = false;
  let tls = false;
  for (let i = 0; pending.length && i < 32; i++) {
    const candidate = pending.shift();
    if (!candidate || typeof candidate !== "object" || visited.has(candidate))
      continue;
    visited.add(candidate);
    const value = candidate as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof value.code === "string" && Object.hasOwn(guidance, value.code)) {
      const [category, fix] = guidance[value.code as keyof typeof guidance];
      return { category, code: value.code, fix };
    }
    if (typeof value.message === "string") {
      timeout ||= /connection.*(?:timeout|timed out)|timeout.*connect/i.test(
        value.message,
      );
      tls ||= /certificate|ssl|tls/i.test(value.message);
    }
    if (value.cause) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors.slice(0, 16));
  }
  if (timeout)
    return {
      category: "connection timeout",
      code: "PG_CONNECTION_TIMEOUT",
      fix: guidance.ETIMEDOUT[1],
    };
  if (tls)
    return {
      category: "TLS failure",
      code: "TLS_FAILURE",
      fix: "Check the trusted database CA, certificate validity and hostname. Keep certificate verification enabled.",
    };
  return {
    category: "unclassified migration failure",
    code: "UNCLASSIFIED",
    fix: "Check private Supabase/database logs and migration history locally. Do not paste raw errors or credentials into shared logs.",
  };
}

export function formatMigrationError(error: unknown) {
  const safe = classifyMigrationError(error);
  return `Migration failed [${safe.category}; ${safe.code}]. ${safe.fix} Connection details remain hidden.`;
}

export const OWNER_PERMISSIONS_SQL = `SELECT
  (r.rolsuper OR r.rolcreaterole) AS can_create_roles,
  has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema,
  has_schema_privilege(current_user,'public','CREATE') AND has_schema_privilege(current_user,'public','USAGE') AS can_use_public_schema,
  COALESCE((SELECT pg_has_role(current_user,c.relowner,'USAGE') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='trustlayer_schema_migrations'),true) AS owns_existing_history
  FROM pg_roles r WHERE r.rolname=current_user`;
export interface OwnerPermissions {
  can_create_roles: boolean;
  can_create_schema: boolean;
  can_use_public_schema: boolean;
  owns_existing_history: boolean;
}
export function sufficientOwnerPermissions(
  value: OwnerPermissions | undefined,
) {
  return (
    !!value &&
    value.can_create_roles === true &&
    value.can_create_schema === true &&
    value.can_use_public_schema === true &&
    value.owns_existing_history === true
  );
}
