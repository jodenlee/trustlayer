"use client";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createSessionStore } from "@/lib/blockchain/session";
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
