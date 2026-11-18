import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "./ui";
export function StatCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  note: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <p className="stat-note">{note}</p>
    </Card>
  );
}
