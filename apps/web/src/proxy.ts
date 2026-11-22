import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_DESTINATION,
  SIGN_IN_PATH,
  hasSessionCookie,
  isProtectedPath,
  signInUrl,
} from "@/lib/auth-routing";

/**
 * Optimistic server-side route protection. Visitors without a well-formed
 * session cookie never receive protected application pages; they are sent to
 * sign-in with their intended destination. A present cookie is NOT treated as
 * authentication: the client gate still requires a server-confirmed session
 * bound to the connected wallet, and every private API authorizes on its own.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = hasSessionCookie((name) => request.cookies.get(name)?.value);
  if (pathname === "/")
    return NextResponse.redirect(
      new URL(signedIn ? DEFAULT_DESTINATION : SIGN_IN_PATH, request.url),
    );
  if (isProtectedPath(pathname) && !signedIn)
    return NextResponse.redirect(
      new URL(signInUrl(`${pathname}${search}`), request.url),
    );
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/projects/:path*",
    "/disputes/:path*",
    "/juror/:path*",
    "/transactions/:path*",
    "/settings/:path*",
  ],
};
