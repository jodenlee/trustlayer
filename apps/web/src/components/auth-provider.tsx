"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useConfig, useConnection } from "wagmi";
import { getConnection, getWalletClient } from "wagmi/actions";
import {
  backendRequest,
  sessionMatches,
  type BackendSession,
} from "@/lib/auth-client";

interface AuthState {
  session: BackendSession | null;
  configured: boolean;
  busy: boolean;
  checking: boolean;
  error: string;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);
export function useBackendAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("Backend authentication provider required");
  return value;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const connection = useConnection();
  const restoring =
    connection.status === "connecting" || connection.status === "reconnecting";
  const scope = restoring
    ? "restoring"
    : connection.isConnected
      ? `${connection.chainId}:${connection.address?.toLowerCase()}`
      : "disconnected";
  const [state, setState] = useState<{
    scope: string;
    session: BackendSession | null;
    configured: boolean;
    checking: boolean;
  }>({
    scope: "disconnected",
    session: null,
    configured: true,
    checking: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const previous = useRef("disconnected");
  const revokeRequired = useRef(false);
  const sessionReadFailed = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    ++generation.current;
    // SSR/hydration and provider restoration are not wallet disconnections.
    // Remember only settled identities; defer revocation until reconnect ends.
    if (scope !== "restoring") {
      if (previous.current !== "disconnected" && previous.current !== scope)
        revokeRequired.current = true;
      previous.current = scope;
    }
    let active = true;
    const refresh = async () => {
      if (!active || inFlight.current) return;
      const id = ++generation.current;
      try {
        if (scope !== "restoring" && revokeRequired.current) {
          await backendRequest("/api/auth/logout", "POST");
          if (!active || id !== generation.current) return;
          revokeRequired.current = false;
        }
        // Always discover the server session on startup, even before the wallet
        // restores. A disconnected startup hides private UI but retains cookies.
        const result = await backendRequest<{
          configured: boolean;
          session: BackendSession | null;
        }>("/api/auth/session");
        if (!active || id !== generation.current) return;
        const current = getConnection(config);
        if (
          result.session &&
          current.status === "connected" &&
          !sessionMatches(result.session, current.address, current.chainId)
        ) {
          await backendRequest("/api/auth/logout", "POST");
          result.session = null;
        }
        if (active && id === generation.current) {
          setState({ scope, ...result, checking: false });
          if (sessionReadFailed.current) setError("");
          sessionReadFailed.current = false;
        }
      } catch (e) {
        if (active && id === generation.current) {
          sessionReadFailed.current = true;
          setState({ scope, session: null, configured: true, checking: false });
          setError(
            e instanceof Error ? e.message : "Backend session check failed.",
          );
        }
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 30_000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [config, scope, busy]);
  const checking = restoring || state.scope !== scope || state.checking;
  const session =
    !checking &&
    connection.status === "connected" &&
    state.scope === scope &&
    sessionMatches(state.session, connection.address, connection.chainId)
      ? state.session
      : null;
  async function signIn() {
    if (inFlight.current || checking) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    sessionReadFailed.current = false;
    ++generation.current;
    const start = getConnection(config);
    const sameWallet = () => {
      const latest = getConnection(config);
      return (
        latest.isConnected &&
        latest.address?.toLowerCase() === start.address?.toLowerCase() &&
        latest.chainId === start.chainId
      );
    };
    try {
      if (!start.isConnected || !start.address || start.chainId !== 31337)
        throw new Error(
          "Connect your wallet on Hardhat Local before signing in.",
        );
      const challenge = await backendRequest<{ message: string }>(
        "/api/auth/nonce",
        "POST",
        { address: start.address, chainId: start.chainId },
      );
      if (!sameWallet())
        throw new Error("Wallet changed. Review a new sign-in request.");
      const wallet = await getWalletClient(config);
      const signature = await wallet.signMessage({
        account: start.address,
        message: challenge.message,
      });
      if (!sameWallet())
        throw new Error(
          "Wallet changed while signing. Sign in again with the current account.",
        );
      const result = await backendRequest<{ session: BackendSession }>(
        "/api/auth/verify",
        "POST",
        { message: challenge.message, signature },
      );
      if (!sameWallet()) {
        await backendRequest("/api/auth/logout", "POST");
        throw new Error("Wallet changed. The old sign-in was revoked.");
      }
      if (!sessionMatches(result.session, start.address, start.chainId))
        throw new Error("The returned session does not match this wallet.");
      setState({
        scope,
        session: result.session,
        configured: true,
        checking: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet sign-in failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    sessionReadFailed.current = false;
    ++generation.current;
    try {
      await backendRequest("/api/auth/logout", "POST");
      setState({ scope, session: null, configured: true, checking: false });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Logout failed. Retry to revoke the server session.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        session,
        configured: state.configured,
        checking,
        busy,
        error,
        signIn,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
