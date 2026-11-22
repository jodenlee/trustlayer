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
import { BlockchainProvider } from "./blockchain-provider";
import { WalletDialog } from "./wallet";
import { WorkflowProvider } from "./workflow-provider";
import { ReviewedActionProvider } from "./reviewed-action";
import { AuthProvider } from "./auth-provider";
import { FileDraftProvider } from "./file-draft-provider";

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
  return (
    <BlockchainProvider>
      <AuthProvider>
        <WorkflowProvider>
          <FileDraftProvider>
            <PreviewProvider>{children}</PreviewProvider>
          </FileDraftProvider>
        </WorkflowProvider>
      </AuthProvider>
    </BlockchainProvider>
  );
}
function PreviewProvider({ children }: { children: ReactNode }) {
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
