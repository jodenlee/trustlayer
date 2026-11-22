import { classifyMigrationError } from "./migration-diagnostics";

export function formatRuntimeError(error: unknown) {
  const safe = classifyMigrationError(error);
  const category =
    safe.code === "UNCLASSIFIED"
      ? "unclassified database failure"
      : safe.category;
  const fix =
    safe.code === "42501"
      ? "Have the owner grant trustlayer_server to the restricted runtime login separately; do not replace DATABASE_URL with owner credentials."
      : safe.code === "28P01"
        ? "Verify the restricted runtime login password and Session Pooler username in DATABASE_URL."
        : "Check the runtime DATABASE_URL endpoint, trusted TLS certificate and role grants. Keep owner credentials separate in DATABASE_MIGRATION_URL.";
  return `Runtime readiness check failed [${category}; ${safe.code}]. ${fix} Connection details remain hidden.`;
}

export const RUNTIME_PERMISSIONS_SQL = `SELECT
  pg_has_role(current_user,'trustlayer_server','MEMBER') AS member,
  NOT EXISTS (SELECT 1 FROM pg_roles r WHERE (pg_has_role(current_user,r.oid,'MEMBER') OR pg_has_role(session_user,r.oid,'MEMBER'))
    AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
      OR r.rolname NOT IN (current_user,session_user,'trustlayer_server'))) AS restricted,
  NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='trustlayer' AND (pg_has_role(current_user,nspowner,'MEMBER') OR pg_has_role(session_user,nspowner,'MEMBER')))
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='trustlayer' AND (pg_has_role(current_user,c.relowner,'MEMBER') OR pg_has_role(session_user,c.relowner,'MEMBER'))) AS not_owner,
  has_schema_privilege(current_user,'trustlayer','USAGE') AS schema_usage,
  NOT EXISTS (SELECT 1 FROM (VALUES ('profiles','SELECT'),('profiles','INSERT'),('profiles','UPDATE'),
    ('auth_sessions','SELECT'),('auth_sessions','INSERT'),('auth_sessions','DELETE'),
    ('files','SELECT'),('files','INSERT'),('files','UPDATE')) AS p(table_name,privilege)
    WHERE NOT has_table_privilege(current_user,'trustlayer.'||p.table_name,p.privilege)) AS application_access
  FROM pg_roles WHERE rolname=current_user`;
export function sufficientRuntimePermissions(
  row: Record<string, unknown> | undefined,
) {
  return (
    !!row &&
    [
      "member",
      "restricted",
      "not_owner",
      "schema_usage",
      "application_access",
    ].every((k) => row[k] === true)
  );
}
