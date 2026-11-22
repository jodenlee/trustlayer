"use client";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createSessionStore } from "@/lib/blockchain/session";
import { deploymentScope } from "@/lib/blockchain/session";
import type { LocalDeployment } from "@trustlayer/contracts";
const Context = createContext<ReturnType<typeof createSessionStore> | null>(
  null,
);
export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useWorkflowSession() {
  const store = useContext(Context);
  if (!store) throw new Error("Workflow provider required");
  useSyncExternalStore(store.subscribe, store.snapshot, () => 0);
  return store;
}
/** Non-sensitive form input survives background verification; never persists to disk. */
export function useWorkflowInput(
  manifest: LocalDeployment | undefined,
  actor: string | undefined,
  name: string,
  fallback = "",
) {
  const store = useWorkflowSession();
  const key = `${manifest ? deploymentScope(manifest) : "unverified"}:${actor?.toLowerCase() ?? "disconnected"}:${name}`;
  return [
    store.input(key, fallback),
    (value: string) => store.setInput(key, value),
  ] as const;
}
