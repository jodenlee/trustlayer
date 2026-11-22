"use client";
import { Coins, Gavel, Info, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  Button,
  Card,
  CardHeading,
  EmptyState,
  PageHeading,
  StatusBadge,
  TextLink,
} from "./ui";
import { StatCard } from "./stats";
import { Money } from "./money";
import { usePreview } from "./providers";
import { useConnection } from "wagmi";
import { ChainJuror } from "./chain-juror";
export function JurorWorkspace() {
  const { isConnected } = useConnection();
  return isConnected ? <ChainJuror /> : <PreviewJurorWorkspace />;
}
function PreviewJurorWorkspace() {
  const { sample, openWallet } = usePreview();
  return (
    <>
      <PageHeading
        title="An independent perspective"
        description="Your juror workspace for stake, assignments, and case review."
        action={
          sample ? (
            <span className="badge badge-blue">Sample juror profile</span>
          ) : undefined
        }
      />
      <div className="stats-grid">
        <StatCard
          label="Deposited stake"
          value={sample ? <Money amount={200_000_000n} /> : "—"}
          note="Available plus locked stake"
          icon={ShieldCheck}
        />
        <StatCard
          label="Available stake"
          value={sample ? <Money amount={100_000_000n} /> : "—"}
          note="Unlocked and withdrawable"
          icon={Coins}
        />
        <StatCard
          label="Locked stake"
          value={sample ? <Money amount={100_000_000n} /> : "—"}
          note="Reserved for one sample assignment"
          icon={LockKeyhole}
        />
        <StatCard
          label="Claimable rewards"
          value="—"
          note="No finalized reward data loaded"
          icon={Gavel}
        />
      </div>
      <div className="detail-grid">
        <div className="space-y-5">
          <Card>
            <CardHeading
              title="Assigned disputes"
              description="Review the case and its timing before voting."
            />
            {sample ? (
              <div className="card-body pt-0!">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">DP-2001 · SAMPLE ASSIGNMENT</p>
                    <h3>Product launch illustrations</h3>
                    <p className="small text-muted mt-1">
                      Illustration set · 600 mUSD disputed
                    </p>
                  </div>
                  <StatusBadge status="Voting open" />
                </div>
                <dl className="summary-list mt-4">
                  <div>
                    <dt>Your vote</dt>
                    <dd>Not loaded</dd>
                  </div>
                  <div>
                    <dt>Voting deadline</dt>
                    <dd>18 Nov, 22:00 UTC</dd>
                  </div>
                  <div>
                    <dt>Assignment lock</dt>
                    <dd>100 mUSD</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-3 mt-5">
                  <TextLink href="/disputes/dp-2001">Review case</TextLink>
                  <Button className="ml-auto" disabled>
                    Cast vote · not enabled
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Ready for a new perspective?"
                description="Wallet connection is available now. Eligibility and assignment reads are planned for a later phase."
                action={
                  <Button variant="secondary" onClick={openWallet}>
                    About wallet connection
                  </Button>
                }
              />
            )}
          </Card>
          <Card>
            <CardHeading
              title="Juror rewards"
              description="Fixed claims, released after finalization."
            />
            <EmptyState
              title="No rewards available to display"
              description="Finalized cases reserve 4 mUSD for each assigned juror, including abstainers. No reward claim or transaction has been loaded."
            />
            <div className="card-body card-divider">
              <Button disabled>Claim rewards · not enabled</Button>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeading
              title="Manage your stake"
              action={sample ? <StatusBadge status="Eligible" /> : undefined}
            />
            <div className="card-body pt-0!">
              <p className="small text-muted">
                At least 100 mUSD of available stake is needed for each new
                assignment. Only unlocked tokens can be withdrawn.
              </p>
              <div className="space-y-3 mt-5">
                <Button className="w-full" disabled>
                  Add stake
                </Button>
                <Button className="w-full" variant="secondary" disabled>
                  Withdraw unlocked stake
                </Button>
              </div>
              <p className="small text-muted mt-3">
                Registration, staking, and reward actions are not enabled in
                this phase.
              </p>
            </div>
          </Card>
          <aside className="protocol-card">
            <ShieldCheck size={25} />
            <h2>Fair rules. Clear responsibilities.</h2>
            <p>
              Selection rotates deterministically through eligible jurors. It is
              not random. Participants cannot judge their own dispute, and each
              case has three distinct jurors.
            </p>
            <p>
              Locks release when a dispute is finalized. Juror stake stays
              separate from escrow and reward reserves.
            </p>
          </aside>
        </div>
      </div>
      <div className="info-note mt-5">
        <Info size={15} />
        <p>
          There are no attendance penalties or stake slashing in the current
          protocol. Do not treat the fixed reward as a promise of real monetary
          returns.
        </p>
      </div>
    </>
  );
}
