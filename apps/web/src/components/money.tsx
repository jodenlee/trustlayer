"use client";
import { formatMUSD } from "@/lib/format";
import { useUi } from "./providers";
export function Money({
  amount,
  unit = true,
}: {
  amount: bigint;
  unit?: boolean;
}) {
  const { precise } = useUi();
  return (
    <span className={`money ${precise ? "money-precise" : ""}`}>
      {formatMUSD(amount, precise)}
      {unit && <span className="currency"> mUSD</span>}
    </span>
  );
}
