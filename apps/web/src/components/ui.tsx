"use client";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Info,
  XCircle,
} from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "primary",
  size,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm";
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`}
      {...props}
    />
  );
}
export function ButtonLink({
  href,
  children,
  variant = "primary",
  size,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Exclude<Variant, "danger">;
  size?: "sm";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`}
    >
      {children}
    </Link>
  );
}
/** A bordered surface. Use sparingly: group related content only. */
export function Card({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={`panel ${className}`} aria-label={label}>
      {children}
    </section>
  );
}
export function CardHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div className="min-w-0">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`panel-body ${className}`}>{children}</div>;
}
export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="panel-footer">{children}</div>;
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  );
}
export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...props} />;
}
export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...props} />;
}
export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
const tones: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  Completed: "success",
  Settled: "success",
  Approved: "success",
  Confirmed: "success",
  Eligible: "success",
  Finalized: "success",
  Active: "info",
  "Voting open": "info",
  "In review": "warning",
  Submitted: "warning",
  "Awaiting acceptance": "warning",
  "Response window": "warning",
  "Ready to finalize": "warning",
  Pending: "neutral",
  Unfunded: "neutral",
  Closed: "neutral",
  "Not eligible": "neutral",
  Disputed: "danger",
  Failed: "danger",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status status-${tones[status] ?? "neutral"}`}>
      {status}
    </span>
  );
}
export function Notice({
  tone = "info",
  title,
  children,
  role,
  label,
  className = "",
}: {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  title?: string;
  children?: ReactNode;
  role?: "alert" | "status";
  label?: string;
  className?: string;
}) {
  const Icon =
    tone === "danger"
      ? XCircle
      : tone === "warning"
        ? AlertTriangle
        : tone === "success"
          ? CheckCircle2
          : Info;
  return (
    <div
      className={`notice notice-${tone} ${className}`}
      role={role}
      aria-label={label}
    >
      <Icon size={16} aria-hidden="true" />
      <div className="min-w-0 grid gap-1">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
export function LoadingRow({ label }: { label: string }) {
  return (
    <div role="status" className="loading-row">
      <Spinner />
      {label}
    </div>
  );
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}
export function LoadingPage() {
  return (
    <div role="status" aria-label="Loading workspace" className="stack">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24" />
      <Skeleton className="h-72" />
      <span className="sr-only">Loading workspace…</span>
    </div>
  );
}
export function KeyValue({
  items,
  stacked = false,
  className = "",
}: {
  items: { label: string; value: ReactNode; testId?: string }[];
  stacked?: boolean;
  className?: string;
}) {
  return (
    <dl className={`kv ${stacked ? "kv-stacked" : ""} ${className}`}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd data-testid={item.testId}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Disclosure({
  summary,
  hint,
  children,
  open,
  plain = false,
  className = "",
}: {
  summary: string;
  hint?: ReactNode;
  children: ReactNode;
  open?: boolean;
  plain?: boolean;
  className?: string;
}) {
  return (
    <details
      className={`disclosure ${plain ? "disclosure-plain" : ""} ${className}`}
      open={open}
    >
      <summary>
        {summary}
        {hint && <span className="summary-hint">{hint}</span>}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
/** Shortened, copyable identifier; the full value stays in the title and clipboard. */
export function Hash({
  value,
  label = "Copy",
  full = false,
}: {
  value: string;
  label?: string;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="hash" title={value}>
      <span className={full ? "hash-full" : undefined}>
        {full || value.length <= 20
          ? value
          : `${value.slice(0, 8)}…${value.slice(-6)}`}
      </span>
      <button
        type="button"
        className="copy-button"
        aria-label={`${label} ${value}`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
export function MilestoneProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  return (
    <div className="milestone-progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Approved milestones"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
      >
        <span style={{ width: `${total ? (completed / total) * 100 : 0}%` }} />
      </div>
      <span className="small text-faint">
        {completed}/{total}
      </span>
    </div>
  );
}
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: {
    title: string;
    render: (row: T) => ReactNode;
    className?: string;
  }[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <div className="table-container">
      <table className="data-table" aria-label={caption}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th scope="col" key={c.title} className={c.className}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.title} data-label={c.title} className={c.className}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function TimelineItem({
  title,
  detail,
  state = "upcoming",
}: {
  title: string;
  detail: string;
  state?: "done" | "current" | "upcoming";
}) {
  return (
    <li className={`step-item ${state}`}>
      <span className="step-dot" aria-hidden="true">
        {state === "done" && <Check size={11} strokeWidth={3} />}
      </span>
      <div>
        <h3>
          {title}
          {state === "current" && <span className="sr-only"> (current)</span>}
        </h3>
        <p>{detail}</p>
      </div>
    </li>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}
