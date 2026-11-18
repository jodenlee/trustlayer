"use client";
import { History, Info } from "lucide-react";
import { usePreview } from "./providers";
import {
  Button,
  Card,
  CardHeading,
  DataTable,
  EmptyState,
  PageHeading,
  TransactionStatus,
} from "./ui";
import type { TransactionView } from "@/lib/models";
import { Money } from "./money";
import { deadlineLabel } from "@/lib/format";
/** Intentionally empty: Phase 3A never manufactures transaction hashes or confirmations. */
const transactions: TransactionView[] = [];
export function Transactions() {
  const { openWallet } = usePreview();
  return (
    <>
      <PageHeading
        title="Transactions"
        description="A verifiable record of funds moving through your workspace."
      />
      <Card>
        <CardHeading
          title="Transaction history"
          description="Type, status, amount, timestamp, and hash will be displayed here."
          action={<History size={18} className="text-muted" />}
        />
        {transactions.length ? (
          <DataTable
            caption="Account transactions"
            rows={transactions}
            rowKey={(tx) => tx.hash}
            columns={[
              { title: "Type", render: (tx) => tx.type },
              {
                title: "Status",
                render: (tx) => <TransactionStatus status={tx.state} />,
              },
              { title: "Amount", render: (tx) => <Money amount={tx.amount} /> },
              {
                title: "Timestamp",
                render: (tx) => deadlineLabel(tx.timestamp),
              },
              {
                title: "Transaction hash",
                render: (tx) => (
                  <code className="break-all small">{tx.hash}</code>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState
            title="Your transaction history starts here"
            description="No wallet is connected and no transactions have been loaded. There are no sample confirmations or transaction hashes."
            action={
              <Button variant="secondary" onClick={openWallet}>
                About wallet connection
              </Button>
            }
          />
        )}
      </Card>
      <div className="info-note mt-5">
        <Info size={15} />
        <p>
          Future transaction status must come from receipt verification on the
          correct chain. A submitted transaction is not a confirmed payment.
        </p>
      </div>
    </>
  );
}
