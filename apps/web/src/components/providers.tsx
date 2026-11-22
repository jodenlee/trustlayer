"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CheckCircle2, X } from "lucide-react";
import { BlockchainProvider } from "./blockchain-provider";
import { WalletDialog } from "./wallet";
import { WorkflowProvider } from "./workflow-provider";
import { ReviewedActionProvider } from "./reviewed-action";
import { AuthProvider } from "./auth-provider";
import { FileDraftProvider } from "./file-draft-provider";

interface UiContext {
  /** Show every six-decimal mUSD digit instead of trimming trailing zeros. */
  precise: boolean;
  setPrecise: (value: boolean) => void;
  openWallet: () => void;
  toast: (message: string) => void;
}
const Context = createContext<UiContext | null>(null);
export function useUi() {
  const context = useContext(Context);
  if (!context) throw new Error("UI provider is required");
  return context;
}
const PRECISION_KEY = "trustlayer:full-precision";
// A per-browser display preference only; storage may be unavailable.
const precisionListeners = new Set<() => void>();
let precisionFallback = false;
function readPrecision() {
  try {
    return localStorage.getItem(PRECISION_KEY) === "true";
  } catch {
    return precisionFallback;
  }
}
function writePrecision(value: boolean) {
  precisionFallback = value;
  try {
    localStorage.setItem(PRECISION_KEY, String(value));
  } catch {
    /* keep the in-memory fallback */
  }
  precisionListeners.forEach((listener) => listener());
}
function subscribePrecision(listener: () => void) {
  precisionListeners.add(listener);
  return () => precisionListeners.delete(listener);
}
export function Providers({ children }: { children: ReactNode }) {
  return (
    <BlockchainProvider>
      <AuthProvider>
        <WorkflowProvider>
          <FileDraftProvider>
            <UiProvider>{children}</UiProvider>
          </FileDraftProvider>
        </WorkflowProvider>
      </AuthProvider>
    </BlockchainProvider>
  );
}
function UiProvider({ children }: { children: ReactNode }) {
  const precise = useSyncExternalStore(
    subscribePrecision,
    readPrecision,
    () => false,
  );
  const [wallet, setWallet] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const setPrecise = useCallback((value: boolean) => {
    writePrecision(value);
  }, []);
  return (
    <Context.Provider
      value={{
        precise,
        setPrecise,
        openWallet: () => setWallet(true),
        toast,
      }}
    >
      <ReviewedActionProvider>{children}</ReviewedActionProvider>
      <WalletDialog open={wallet} onClose={() => setWallet(false)} />
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message && (
          <div className="toast">
            <CheckCircle2 size={17} aria-hidden="true" />
            <p>{message}</p>
            <button
              aria-label="Dismiss notification"
              onClick={() => setMessage("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
