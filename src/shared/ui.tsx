// Layout pieces shared by every workspace.

import type { ReactNode } from "react";
import { IconRefresh } from "./icons";

export function Kpi({
  label,
  value,
  hint,
  tone,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "warn" | "bad";
  children?: ReactNode;
}) {
  const color =
    tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-rose-400" : "text-slate-100";
  return (
    <div className="glass animate-rise rounded-2xl p-4">
      <div className="label">{label}</div>
      <div className={`num mt-2 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function ViewHeader({
  title,
  subtitle,
  actions,
  refreshing,
  fetchedAt,
  onRefresh,
  refreshTitle = "Refresh from TargetProcess (⌘R)",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  refreshing?: boolean;
  fetchedAt?: string | null;
  onRefresh?: () => void;
  refreshTitle?: string;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {onRefresh && (
          <button className="btn" onClick={onRefresh} title={refreshTitle}>
            <IconRefresh size={14} className={refreshing ? "animate-spin" : ""} />
            <span className="num text-[11px] font-normal text-slate-500">{fetchedAt ? relativeTime(fetchedAt) : "—"}</span>
          </button>
        )}
      </div>
    </header>
  );
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function ErrorBanner({
  error,
  title = "Could not refresh from TargetProcess.",
}: {
  error: string | null;
  title?: string;
}) {
  if (!error) return null;
  return (
    <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
      <span className="font-semibold">{title}</span>{" "}
      <span className="text-rose-300/80">{error}</span>
    </div>
  );
}

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
      {icon && <div className="mb-3 text-slate-600">{icon}</div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-12" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}
