import Link from "next/link";
import {
  ArrowRight,
  Check,
  Circle,
  Clock3,
  FolderOpen,
  LoaderCircle,
  X,
} from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import type { TransactionState } from "@/lib/models";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return <button className={`btn btn-${variant} ${className}`} {...props} />;
}
export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <Link href={href} className={`btn btn-${variant} ${className}`}>
      {children}
    </Link>
  );
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function CardHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-heading">
      <div>
        <h2>{title}</h2>
        {description && <p className="text-muted small mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="text-muted mt-2">{description}</p>
      </div>
      {action && <div className="page-action">{action}</div>}
    </div>
  );
}
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...props} />;
}
export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-muted small">
          {hint}
        </p>
      )}
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const tone = ["Approved", "Completed", "Confirmed", "Eligible"].includes(
    status,
  )
    ? "green"
    : ["Disputed", "Failed"].includes(status)
      ? "red"
      : [
            "Submitted",
            "Response window",
            "Awaiting acceptance",
            "Pending",
          ].includes(status)
        ? "amber"
        : ["Active", "Voting open"].includes(status)
          ? "blue"
          : "gray";
  return (
    <span className={`badge badge-${tone}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <FolderOpen size={25} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}
export function LoadingPage() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="stats-grid">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <span className="sr-only">Loading workspace…</span>
    </div>
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
      <span className="small text-muted">
        {completed}/{total}
      </span>
    </div>
  );
}
export function TransactionStatus({ status }: { status: TransactionState }) {
  const Icon =
    status === "Confirmed" ? Check : status === "Failed" ? X : LoaderCircle;
  return (
    <span className={`transaction-status ${status.toLowerCase()}`}>
      <Icon size={15} aria-hidden="true" />
      {status}
    </span>
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
      <table className="data-table">
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
  const Icon = state === "done" ? Check : state === "current" ? Clock3 : Circle;
  return (
    <li className={`timeline-item ${state}`}>
      <span className="timeline-icon">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div>
        <h3>{title}</h3>
        <p className="small text-muted mt-1">{detail}</p>
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
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}
