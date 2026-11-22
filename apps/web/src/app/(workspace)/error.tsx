"use client";
import { Button, EmptyState } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="panel" role="alert">
      <EmptyState
        title="Something went wrong on this page"
        description="Nothing was submitted to the blockchain. Try again, or refresh the page."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
