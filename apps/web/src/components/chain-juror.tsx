"use client";
import { useJuror } from "@/lib/blockchain/hooks/use-arbitration";
import { parseMUSD } from "@/lib/format";
import { executeJurorAction } from "@/lib/blockchain/arbitration-actions";
import { describeError } from "@/lib/blockchain/errors";
import {
  Button,
  Card,
  CardHeading,
  EmptyState,
  Field,
  Input,
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
        title="Your juror workspace"
        description="Manage your own stake and review public on-chain assignments. Selection rotates deterministically; it is not random."
      />
      <Card>
        <CardHeading
          title="Registration & collateral"
          action={
            view && (
              <StatusBadge
                status={view.eligible ? "Eligible" : "Not eligible"}
              />
            )
          }
        />
        {!view ? (
          <EmptyState
            title={
              !read.deployment.ready
                ? "Verify your local connection"
                : read.error
                  ? "Juror reads failed"
                  : "Loading juror stake…"
            }
            description={
              read.error
                ? describeError(read.error).message
                : "Actual wallet stake is shown after verification; no sample balance is substituted."
            }
            action={
              <Button variant="secondary" onClick={() => void read.refetch()}>
                Retry juror reads
              </Button>
            }
          />
        ) : (
          <div className="card-body pt-0!">
            <p className="wallet-address">
              Acting juror wallet: {read.deployment.address}
            </p>
            <dl className="summary-list mt-4">
              <div>
                <dt>Registered</dt>
                <dd>{view.info.registered ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Minimum unlocked for a new assignment</dt>
                <dd>
                  <Money amount={view.minimum} />
                </dd>
              </div>
              <div>
                <dt>Deposited stake</dt>
                <dd data-testid="juror-deposited">
                  <Money amount={view.info.depositedStake} />
                </dd>
              </div>
              <div>
                <dt>Locked stake</dt>
                <dd data-testid="juror-locked">
                  <Money amount={view.info.lockedStake} />
                </dd>
              </div>
              <div>
                <dt>Available stake</dt>
                <dd data-testid="juror-available">
                  <Money amount={view.info.availableStake} />
                </dd>
              </div>
              <div>
                <dt>Active assignments</dt>
                <dd>{view.info.activeAssignments.toString()}</dd>
              </div>
              <div>
                <dt>Wallet mUSD balance</dt>
                <dd>
                  <Money amount={view.balance} />
                </dd>
              </div>
              <div>
                <dt>Registry allowance</dt>
                <dd>
                  <Money amount={view.allowance} />
                </dd>
              </div>
            </dl>
            {!view.info.registered ? (
              <div className="mt-5">
                <ReviewedAction
                  title="Register as juror"
                  disabled={read.isFetching}
                  submit={(context) => executeJurorAction(context, "register")}
                >
                  <p>
                    Register this wallet once. Registration transfers no mUSD
                    and does not make you eligible until at least 100 mUSD is
                    unlocked in the registry. Local ETH is required for gas.
                  </p>
                </ReviewedAction>
              </div>
            ) : (
              <div className="form-grid mt-5">
                <div className="space-y-3">
                  <Field
                    id="stake-deposit"
                    label="Deposit amount (mUSD)"
                    hint="Positive amount, up to six decimal places. Approval and deposit are separate transactions."
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
                        ? "Deposit your approved tokens into juror custody. At least 100 mUSD unlocked is needed for each new assignment."
                        : "Approve only the entered amount to JurorRegistry. This does not deposit tokens; wait for confirmation, then review the separate deposit."}
                    </p>
                    <p className="mt-3">
                      Amount <Money amount={amount ?? 0n} />
                    </p>
                  </ReviewedAction>
                </div>
                <div className="space-y-3">
                  <Field
                    id="stake-withdrawal"
                    label="Withdraw amount (mUSD)"
                    hint="Only your available stake can be withdrawn; locked collateral is unavailable until finalization."
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
                  <ReviewedAction
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
                      Withdraw <Money amount={withdrawal ?? 0n} /> to your own
                      wallet. This may make you ineligible for new assignments
                      if remaining unlocked stake is below 100 mUSD. Existing
                      locked collateral cannot be spent.
                    </p>
                  </ReviewedAction>
                </div>
              </div>
            )}
            <p className="small text-muted mt-5">
              Every assignment locks 100 mUSD. A finalized case releases that
              case’s locks; other cases may still lock collateral. There are no
              slashing or attendance penalties. Rewards are separate per-case
              claims below.
            </p>
            <Button
              variant="ghost"
              className="mt-3"
              disabled={read.isFetching}
              onClick={() => void read.refetch()}
            >
              Refresh juror balances
            </Button>
          </div>
        )}
      </Card>
      <ChainDisputes jurorOnly />
    </>
  );
}
