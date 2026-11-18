"use client";
import { Button } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <h1>We couldn’t display this page.</h1>
      <p>Please try again. No blockchain operation was performed.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
