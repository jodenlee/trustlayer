import type { PoolConfig } from "pg";
import { ApiError } from "./errors";

export function authOrigin(
  env: Record<string, string | undefined> = process.env,
) {
  const value =
    env.AUTH_ORIGIN ??
    (env.NODE_ENV === "production" ? "" : "http://127.0.0.1:3000");
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      (env.NODE_ENV === "production" && url.protocol !== "https:")
    )
      throw new Error();
    return value;
  } catch {
    throw new ApiError(
      503,
      "backend_setup",
      "Configure AUTH_ORIGIN with the exact application origin; production requires HTTPS.",
    );
  }
}
export function databaseConfig(
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    // pg connection-string SSL options can override explicit certificate checks.
    if ([...url.searchParams.keys()].some((key) => /^ssl/i.test(key)))
      throw new Error();
    return {
      connectionString: url.toString(),
      ssl: local
        ? false
        : {
            rejectUnauthorized: true,
            ...(env.DATABASE_CA_CERT
              ? { ca: env.DATABASE_CA_CERT.replace(/\\n/g, "\n") }
              : {}),
          },
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    };
  } catch {
    throw new ApiError(
      503,
      "backend_setup",
      "Configure a server-only PostgreSQL DATABASE_URL without ssl query parameters. See docs/PHASE4A.md.",
    );
  }
}
