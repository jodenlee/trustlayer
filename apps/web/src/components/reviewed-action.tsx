"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Hash } from "viem";
import { useVerifiedDeployment } from "@/lib/blockchain/hooks/use-protocol";
import {
  useProtocolTransaction,
  type ProtocolWriteContext,
} from "@/lib/blockchain/hooks/use-protocol-transaction";
import { deploymentScope, type AttemptDetails } from "@/lib/blockchain/session";
import { describeError } from "@/lib/blockchain/errors";
import type { ReceiptSummary } from "@/lib/blockchain/transactions";
import { Button } from "./ui";
import { Dialog } from "./dialog";
import { TransactionFeedback } from "./transaction-feedback";
import { usePreview } from "./providers";

type Submission = (context: ProtocolWriteContext) => Promise<Hash>;
/** Snapshot the reviewed action, actor and deployment. Keep feedback visible until explicit dismissal. */
interface ActionProps {
  title: string;
  children: ReactNode;
  disabled?: boolean;
  submit: Submission;
  details?: Omit<AttemptDetails, "kind" | "expectedScope">;
  onConfirmed?: (
    receipt: ReceiptSummary,
    context: ProtocolWriteContext,
  ) => Promise<void>;
}
const ReviewContext = createContext<{
  busy: boolean;
  open: (action: ActionProps) => void;
} | null>(null);
export function ReviewedActionProvider({ children }: { children: ReactNode }) {
  const deployment = useVerifiedDeployment();
  const tx = useProtocolTransaction();
  const { toast } = usePreview();
  const [review, setReview] = useState<{
    actor: string;
    scope: string;
    submit: Submission;
    title: string;
    details: ActionProps["details"];
    content: ReactNode;
    confirmed?: ActionProps["onConfirmed"];
  }>();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const flight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const same =
    !!review &&
    deployment.ready &&
    review.actor === deployment.address?.toLowerCase() &&
    review.scope === deploymentScope(deployment.data!.manifest);
  useEffect(() => {
    if (review && (tx.state.phase !== "idle" || error))
      feedback.current?.scrollIntoView({ block: "nearest" });
  }, [review, tx.state.phase, error]);
  async function confirm() {
    if (flight.current || tx.isBusy() || done) return;
    if (!same || !review) {
      setError(
        "The wallet or deployment changed. Close this dialog and review again.",
      );
      return;
    }
    flight.current = true;
    setError("");
    try {
      let originalContext: ProtocolWriteContext | undefined;
      const receipt = await tx.execute(
        async (context) => {
          originalContext = context;
          return review.submit(context);
        },
        { ...review.details, kind: review.title, expectedScope: review.scope },
      );
      if (receipt) {
        setDone(true);
        toast(`${review.title} confirmed.`);
        if (review.confirmed && originalContext) {
          await review.confirmed(receipt, originalContext);
          setReview(undefined);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : describeError(e).message);
    } finally {
      flight.current = false;
    }
  }
  return (
    <ReviewContext.Provider
      value={{
        busy: tx.isBusy(),
        open: (action) => {
          if (tx.isBusy()) return;
          tx.reset();
          setDone(false);
          setError("");
          if (deployment.ready)
            setReview({
              actor: deployment.address!.toLowerCase(),
              scope: deploymentScope(deployment.data!.manifest),
              title: action.title,
              submit: action.submit,
              details: action.details,
              content: action.children,
              confirmed: action.onConfirmed,
            });
        },
      }}
    >
      {children}
      <Dialog
        open={!!review}
        title={review?.title ?? "Review transaction"}
        onClose={() => setReview(undefined)}
      >
        <div ref={feedback}>
          <TransactionFeedback state={tx.state} />
          {error && (
            <p role="alert" className="form-error mt-3">
              {error}
            </p>
          )}
        </div>
        <p className="wallet-address mt-3">Acting wallet: {review?.actor}</p>
        <div className="mt-4">{review?.content}</div>
        {!same && (
          <p className="wallet-warning mt-3">
            The wallet or deployment changed or is being verified. Review again
            after verification.
          </p>
        )}
        <Button
          type="button"
          className="w-full mt-5"
          disabled={!same || tx.isBusy() || done}
          onClick={() => void confirm()}
        >
          {done
            ? "Confirmed"
            : tx.isBusy()
              ? "Request pending…"
              : "Confirm in wallet"}
        </Button>
      </Dialog>
    </ReviewContext.Provider>
  );
}
export function ReviewedAction(props: ActionProps) {
  const context = useContext(ReviewContext);
  const deployment = useVerifiedDeployment();
  if (!context) throw new Error("ReviewedActionProvider required");
  return (
    <Button
      type="button"
      disabled={props.disabled || !deployment.ready || context.busy}
      onClick={() => context.open(props)}
    >
      {props.title}
    </Button>
  );
}
