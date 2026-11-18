"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, X } from "lucide-react";
import { Dialog } from "./dialog";
import { Button } from "./ui";

interface PreviewContext {
  sample: boolean;
  setSample: (value: boolean) => void;
  name: string;
  setName: (value: string) => void;
  precise: boolean;
  setPrecise: (value: boolean) => void;
  openWallet: () => void;
  toast: (message: string) => void;
}
const Context = createContext<PreviewContext | null>(null);
export function usePreview() {
  const context = useContext(Context);
  if (!context) throw new Error("Preview provider is required");
  return context;
}
export function Providers({ children }: { children: ReactNode }) {
  const [sample, setSample] = useState(true);
  const [name, setName] = useState("Alex Morgan");
  const [precise, setPrecise] = useState(false);
  const [wallet, setWallet] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Context.Provider
      value={{
        sample,
        setSample,
        name,
        setName,
        precise,
        setPrecise,
        openWallet: () => setWallet(true),
        toast,
      }}
    >
      {children}
      <Dialog
        open={wallet}
        onClose={() => setWallet(false)}
        title="Wallet connection"
      >
        <span className="badge badge-blue">Coming in Phase 3B</span>
        <p className="mt-4">
          This is an interface preview. Wallet connection is not available yet,
          and no connection request was made.
        </p>
        <p className="small text-muted mt-3">
          Your funds stay in your wallet. This app does not read balances, send
          transactions or contact a blockchain.
        </p>
        <Button className="mt-6" onClick={() => setWallet(false)}>
          Got it
        </Button>
      </Dialog>
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message && (
          <div className="toast">
            <CheckCircle2 size={19} aria-hidden="true" />
            <p>{message}</p>
            <button
              aria-label="Dismiss notification"
              onClick={() => setMessage("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
