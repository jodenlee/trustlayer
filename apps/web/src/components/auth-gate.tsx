"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBackendAuth } from "./auth-provider";
import { SIGN_IN_PATH, signInUrl } from "@/lib/auth-routing";
import { Spinner } from "./ui";

export function FullscreenStatus({ label }: { label: string }) {
  return (
    <div className="fullscreen-status" role="status" aria-live="polite">
      <div>
        <Spinner />
        {label}
      </div>
    </div>
  );
}
/**
 * Renders protected pages only for a server-confirmed SIWE session that
 * matches the connected wallet and network. Waits for wallet restoration and
 * the session read before deciding, so a refresh never redirects prematurely.
 * Private data is still authorized independently by every API route.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useBackendAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hadSession = useRef(false);
  const authorized = !!auth.session;
  const decided = !auth.checking && !auth.busy;
  useEffect(() => {
    if (authorized) hadSession.current = true;
  }, [authorized]);
  useEffect(() => {
    if (!decided || authorized) return;
    if (auth.signedOut) {
      router.replace(SIGN_IN_PATH);
      return;
    }
    const target = signInUrl(`${pathname}${window.location.search}`);
    router.replace(
      hadSession.current
        ? `${target}${target.includes("?") ? "&" : "?"}ended=1`
        : target,
    );
  }, [decided, authorized, auth.signedOut, pathname, router]);
  if (!authorized)
    return (
      <FullscreenStatus
        label={decided ? "Redirecting to sign-in…" : "Restoring your session…"}
      />
    );
  return children;
}
