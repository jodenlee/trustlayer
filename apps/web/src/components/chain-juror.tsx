"use client";
import { RefreshCw } from "lucide-react";
import { useJuror } from "@/lib/blockchain/hooks/use-arbitration";
import { parseMUSD } from "@/lib/format";
import { executeJurorAction } from "@/lib/blockchain/arbitration-actions";
import { describeError } from "@/lib/blockchain/errors";
import {
  Button,
  Card,
  CardBody,
  CardHeading,
  EmptyState,
  Field,
  Input,
  LoadingRow,
  PageHeading,
  StatusBadge,
} from "./ui";
import { Money } from "./money";
import { ReviewedAction } from "./reviewed-action";
import { ChainDisputes } from "./chain-disputes";
import { useWorkflowInput } from "./workflow-provider";

export function ChainJuror() {
  const read = useJuror();
  const [deposit, setDeposit] = useWorkflowInput(
    read.deployment.data?.manifest,
    read.deployment.address,
    "stake-deposit",
    "100",
  );
  const [withdraw, setWithdraw] = useWorkflowInput(
    read.deployment.data?.manifest,
    read.deployment.address,
    "stake-withdrawal",
  );
  const amount = parseMUSD(deposit);
  const withdrawal = parseMUSD(withdraw);
  const view = read.view;
  return (
    <>
      <PageHeading
        eyebrow={
          view && (
            <StatusBadge status={view.eligible ? "Eligible" : "Not eligible"} />
          )
        }
        title="Jury"
        description="Stake mUSD to be assigned disputes in rotation, vote on the outcome, and earn 4 mUSD per case."
      />
      <div className="stack">
        {!view ? (
          <Card>
            {read.deployment.ready && !read.error ? (
              <LoadingRow label="Loading juror stake…" />
            ) : (
              <EmptyState
                title={
                  !read.deployment.ready
                    ? "Waiting for the local network"
                    : "Couldn’t load your juror account"
                }
                description={
                  read.error
                    ? describeError(read.error).message
                    : "Your stake loads once your wallet and the contracts are verified."
                }
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void read.refetch()}
                  >
                    Retry juror reads
                  </Button>
                }
              />
            )}
          </Card>
        ) : (
          <>
            <dl className="figures" aria-label="Juror stake">
              <div>
                <dt>Deposited stake</dt>
                <dd data-testid="juror-deposited">
                  <Money amount={view.info.depositedStake} />
                </dd>
              </div>
              <div>
                <dt>Locked in cases</dt>
                <dd data-testid="juror-locked">
                  <Money amount={view.info.lockedStake} />
                </dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd data-testid="juror-available">
                  <Money amount={view.info.availableStake} />
                </dd>
              </div>
              <div>
                <dt>Active cases</dt>
                <dd>{view.info.activeAssignments.toString()}</dd>
              </div>
            </dl>
            {!view.info.registered ? (
              <div className="next-step" aria-label="Become a juror">
                <span className="eyebrow-label">GET STARTED</span>
                <h2>Register as a juror</h2>
                <p>
                  Registration is free (gas only) and moves no tokens. You
                  become eligible once at least <Money amount={view.minimum} />{" "}
                  of stake is available, and each case you’re assigned locks
                  that amount until the case is finalized.
                </p>
                <div className="button-row">
                  <ReviewedAction
                    title="Register as juror"
                    disabled={read.isFetching}
                    submit={(context) =>
                      executeJurorAction(context, "register")
                    }
                  >
                    <p>
                      Register this wallet once. This transfers no mUSD. You
                      become eligible after depositing at least 100 mUSD of
                      stake.
                    </p>
                  </ReviewedAction>
                </div>
              </div>
            ) : (
              <div className="grid-2">
                <Card label="Add stake">
                  <CardHeading
                    title="Add stake"
                    description={
                      <>
                        Wallet balance <Money amount={view.balance} />
                      </>
                    }
                  />
                  <CardBody className="stack-sm">
                    <Field
                      id="stake-deposit"
                      label="Deposit amount (mUSD)"
                      hint="Up to six decimal places. Approval and deposit are two separate confirmations."
                    >
                      <Input
                        id="stake-deposit"
                        inputMode="decimal"
                        value={deposit}
                        onChange={(e) => setDeposit(e.target.value)}
                      />
                    </Field>
                    {amount === null ? (
                      <p className="small text-muted">
                        Enter a positive amount with at most six decimal places.
                      </p>
                    ) : amount > view.balance ? (
                      <p role="alert" className="form-error">
                        Insufficient mUSD balance for this deposit.
                      </p>
                    ) : null}
                    <div className="button-row">
                      <ReviewedAction
                        title={
                          amount !== null && view.allowance >= amount
                            ? "Deposit stake"
                            : "Approve exact stake allowance"
                        }
                        disabled={
                          read.isFetching ||
                          amount === null ||
                          amount > view.balance
                        }
                        details={{ amount: amount ?? undefined }}
                        submit={(context) =>
                          executeJurorAction(
                            context,
                            amount !== null && view.allowance >= amount
                              ? "deposit"
                              : "approveStake",
                            amount!,
                          )
                        }
                      >
                        <p>
                          {amount !== null && view.allowance >= amount
                            ? "Deposit your approved mUSD as juror stake. At least 100 mUSD available is needed for each new assignment."
                            : "Allow the juror registry to take exactly this amount. This doesn’t deposit anything yet; once it’s confirmed, review the deposit separately."}
                        </p>
                        <p className="mt-3">
                          Amount <Money amount={amount ?? 0n} />
                        </p>
                      </ReviewedAction>
                    </div>
                  </CardBody>
                </Card>
                <Card label="Withdraw stake">
                  <CardHeading
                    title="Withdraw stake"
                    description={
                      <>
                        Available now{" "}
                        <Money amount={view.info.availableStake} />
                      </>
                    }
                  />
                  <CardBody className="stack-sm">
                    <Field
                      id="stake-withdrawal"
                      label="Withdraw amount (mUSD)"
                      hint="Stake locked in open cases can’t be withdrawn until those cases are finalized."
                    >
                      <Input
                        id="stake-withdrawal"
                        inputMode="decimal"
                        value={withdraw}
                        onChange={(e) => setWithdraw(e.target.value)}
                      />
                    </Field>
                    {withdrawal !== null &&
                      withdrawal > view.info.availableStake && (
                        <p role="alert" className="form-error">
                          Withdrawal exceeds unlocked stake.
                        </p>
                      )}
                    <div className="button-row">
                      <ReviewedAction
                        variant="secondary"
                        title="Withdraw unlocked stake"
                        disabled={
                          read.isFetching ||
                          withdrawal === null ||
                          withdrawal > view.info.availableStake
                        }
                        details={{ amount: withdrawal ?? undefined }}
                        submit={(context) =>
                          executeJurorAction(context, "withdraw", withdrawal!)
                        }
                      >
                        <p>
                          Withdraw <Money amount={withdrawal ?? 0n} /> to your
                          wallet. If less than 100 mUSD remains available, you
                          won’t receive new assignments. Locked stake isn’t
                          affected.
                        </p>
                      </ReviewedAction>
                    </div>
                  </CardBody>
                </Card>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="small text-muted">
                Jurors are selected by deterministic rotation, not at random.
                There are no penalties for how you vote; every assigned juror
                can claim 4 mUSD once the case is finalized.
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={read.isFetching}
                onClick={() => void read.refetch()}
              >
                <RefreshCw size={13} aria-hidden="true" />
                Refresh juror balances
              </Button>
            </div>
          </>
        )}
        <ChainDisputes jurorOnly />
      </div>
    </>
  );
}
