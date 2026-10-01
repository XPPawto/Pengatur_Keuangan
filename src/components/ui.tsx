import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import type { Tone } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "", title, action, icon }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <section className={`card card-pad ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              {icon && <Icon name={icon} size={18} className="text-muted" />}
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE_BADGE: Record<Tone | "neutral" | "brand", string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  neutral: "bg-subtle text-fg-2",
  brand: "bg-brand-soft text-brand",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone | "neutral" | "brand"; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_BADGE[tone]}`}>
      {icon && <Icon name={icon} size={13} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: IconName }) {
  const warna = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="card card-pad">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </p>
      <p className={`num mt-1 text-2xl font-bold tracking-tight ${warna}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Alert({ tone = "info", children, action }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode; action?: ReactNode }) {
  const cls = { info: "bg-brand-soft text-brand", ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad" }[tone];
  const icon: IconName = tone === "ok" ? "check-circle" : tone === "info" ? "info" : "alert";
  return (
    <div role={tone === "bad" || tone === "warn" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ${cls}`}>
      <Icon name={icon} size={18} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, href, cta }: { icon: IconName; title: string; children?: ReactNode; href?: string; cta?: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-subtle text-muted">
        <Icon name={icon} size={22} />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {href && cta && (
        <Link href={href} className="btn mt-4">
          {cta}
        </Link>
      )}
    </div>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <Alert tone="bad">{state.error}</Alert>;
  if (state.ok) return <Alert tone="ok">{state.ok}</Alert>;
  return null;
}
