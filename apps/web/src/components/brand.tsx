import Link from "next/link";

export function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8 2.2 14 5.3 8 8.4 2 5.3Z" fill="currentColor" />
      <path
        d="m2 8.2 6 3.1 6-3.1M2 10.9 8 14l6-3.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".7"
      />
    </svg>
  );
}
export function Logo({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="TrustLayer home">
      <span className="logo-mark">
        <BrandMark />
      </span>
      TrustLayer
    </Link>
  );
}
