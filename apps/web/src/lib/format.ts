const SCALE = 1_000_000n;
export function formatMUSD(amount: bigint, fullPrecision = false): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = (absolute / SCALE).toLocaleString("en-US");
  const fractional = (absolute % SCALE).toString().padStart(6, "0");
  const decimals = fullPrecision
    ? fractional
    : fractional.replace(/0+$/, "").padEnd(2, "0");
  return `${sign}${whole}.${decimals}`;
}
export function parseMUSD(value: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fractional = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fractional.padEnd(6, "0"));
  return result > 0n && result <= (1n << 256n) - 1n ? result : null;
}
export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function deadlineLabel(value: string): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}
