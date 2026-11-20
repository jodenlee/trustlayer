"use client";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConfig, useConnection } from "wagmi";
import { getConnection } from "wagmi/actions";
import { useBackendAuth } from "./auth-provider";
import { createFileDraftStore, settledFileIdentity } from "@/lib/file-drafts";

const Context = createContext<{
  store: ReturnType<typeof createFileDraftStore>;
  authorized: (identity: string, actor: string) => boolean;
} | null>(null);
export function FileDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFileDraftStore);
  const connection = useConnection(),
    config = useConfig(),
    auth = useBackendAuth();
  const current = useRef<string | undefined>(undefined);
  const settled = useRef<string | undefined>(undefined);
  const identity = auth.session
    ? `${auth.session.address}:${auth.session.expiresAt}`
    : undefined;
  useLayoutEffect(() => {
    current.current = identity;
    return () => {
      current.current = undefined;
    };
  }, [identity]);
  useLayoutEffect(() => {
    const next = settledFileIdentity(
      connection.status,
      connection.address,
      connection.chainId,
    );
    if (next === null) return;
    if (settled.current !== next) store.clear();
    settled.current = next;
  }, [connection.status, connection.address, connection.chainId, store]);
  return (
    <Context.Provider
      value={{
        store,
        authorized: (expected, actor) => {
          const wallet = getConnection(config);
          return (
            current.current === expected &&
            Date.parse(expected.slice(expected.indexOf(":") + 1)) >
              Date.now() &&
            wallet.status === "connected" &&
            wallet.chainId === 31337 &&
            wallet.address?.toLowerCase() === actor
          );
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useFileDraft(scope: string) {
  const context = useContext(Context);
  if (!context) throw new Error("File draft provider required");
  const draft = useSyncExternalStore(
    context.store.subscribe,
    () => context.store.get(scope),
    () => undefined,
  );
  return { ...context, draft };
}
