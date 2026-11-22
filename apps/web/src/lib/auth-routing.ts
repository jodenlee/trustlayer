/**
 * Route-protection helpers shared by the proxy, the client gate and the
 * sign-in page. The proxy only performs an optimistic cookie-presence check;
 * the client gate requires a server-confirmed SIWE session matching the
 * connected wallet, and every private API authorizes independently.
 */
export const SIGN_IN_PATH = "/sign-in";
export const DEFAULT_DESTINATION = "/dashboard";
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/disputes",
  "/juror",
  "/transactions",
  "/settings",
] as const;
/** Both names exist: production uses the __Host- prefix with Secure cookies. */
export const SESSION_COOKIES = ["__Host-tl_session", "tl_session"] as const;
const TOKEN = /^[a-f0-9]{64}$/;

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
/** True when a well-formed session cookie is present. Not proof of a valid session. */
export function hasSessionCookie(read: (name: string) => string | undefined) {
  return SESSION_COOKIES.some((name) => TOKEN.test(read(name) ?? ""));
}
/**
 * Accept only same-origin, protected application paths as a post-sign-in
 * destination. Anything else (absolute URLs, protocol-relative paths,
 * backslashes, the sign-in page itself) falls back to the dashboard.
 */
export function safeDestination(value: string | null | undefined) {
  if (!value || value.length > 512) return DEFAULT_DESTINATION;
  if (!value.startsWith("/") || value.startsWith("//"))
    return DEFAULT_DESTINATION;
  if (/[\\\u0000-\u001f]/.test(value)) return DEFAULT_DESTINATION;
  let url: URL;
  try {
    url = new URL(value, "http://trustlayer.invalid");
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (url.origin !== "http://trustlayer.invalid") return DEFAULT_DESTINATION;
  if (!isProtectedPath(url.pathname)) return DEFAULT_DESTINATION;
  return `${url.pathname}${url.search}`;
}
export function signInUrl(destination?: string) {
  const next = destination ? safeDestination(destination) : DEFAULT_DESTINATION;
  return next === DEFAULT_DESTINATION
    ? SIGN_IN_PATH
    : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
