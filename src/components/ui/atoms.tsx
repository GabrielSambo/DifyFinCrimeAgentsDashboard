import type { Confidence, ScreeningStatus } from "@/lib/types";
import { type LightState, type DocStatus, docPhase, DOC_PHASE_META } from "@/lib/documents";
import { reviewStatus } from "@/lib/review";

/* ---------- Derived review-due badge ---------- */

/** Real "review due/overdue" badge derived from the analyst-set cadence + the anchor (last-screened) date. */
export function ReviewBadge({
  cadenceDays,
  anchorIso,
  className = "",
}: {
  cadenceDays?: number | null;
  anchorIso?: string | null;
  className?: string;
}) {
  const rs = reviewStatus(cadenceDays, anchorIso);
  if (!rs) return null;
  const fg = rs.tone === "bad" ? "text-bad" : rs.tone === "warn" ? "text-warn" : "text-ink-3";
  return <span className={`text-[11px] font-medium ${fg} ${className}`}>{rs.label}</span>;
}

/* ---------- Document-status traffic light ---------- */

const LIGHT_STYLE: Record<LightState, { dot: string; ring: string }> = {
  green: { dot: "bg-good", ring: "" },
  amber: { dot: "bg-warn", ring: "" },
  red: { dot: "bg-bad", ring: "" },
  unknown: { dot: "bg-transparent", ring: "ring-1 ring-inset ring-border-strong" },
};

/** A single document-lifecycle dot. `state` is unknown when we have no data to assert that stage. */
export function TrafficLight({ state, title }: { state: LightState; title?: string }) {
  const s = LIGHT_STYLE[state] ?? LIGHT_STYLE.unknown;
  return (
    <span
      title={title ? `${title}: ${state}` : state}
      className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot} ${s.ring}`}
    />
  );
}

/* ---------- Document-status phase pill ---------- */

const PHASE_TONE: Record<"good" | "warn" | "bad" | "neutral", { bg: string; dot: string }> = {
  good: { bg: "bg-good-bg text-good", dot: "bg-good" },
  warn: { bg: "bg-warn-bg text-warn", dot: "bg-warn" },
  bad: { bg: "bg-bad-bg text-bad", dot: "bg-bad" },
  neutral: { bg: "bg-surface-2 text-ink-3", dot: "bg-ink-3" },
};

/** The portfolio's headline status: one of Validated / Pending / Requested / No documents. */
export function DocStatusBadge({ ds }: { ds?: DocStatus | null }) {
  const { label, tone } = DOC_PHASE_META[docPhase(ds)];
  const s = PHASE_TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  );
}

/* ---------- Confidence badge ---------- */

const CONFIDENCE_STYLE: Record<Confidence, { bg: string; fg: string; label: string }> = {
  high: { bg: "bg-good-bg", fg: "text-good", label: "High confidence" },
  medium: { bg: "bg-warn-bg", fg: "text-warn", label: "Medium confidence" },
  low: { bg: "bg-surface-2", fg: "text-ink-3", label: "Low confidence" },
};

export function ConfidenceBadge({ level }: { level?: Confidence | null }) {
  if (!level) return null;
  const s = CONFIDENCE_STYLE[level] ?? CONFIDENCE_STYLE.low;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.fg}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

/* ---------- Screening status pill ---------- */

const SCREENING_STYLE: Record<ScreeningStatus, { bg: string; fg: string; label: string }> = {
  no_match: { bg: "bg-good-bg", fg: "text-good", label: "Clear" },
  match: { bg: "bg-bad-bg", fg: "text-bad", label: "Hit" },
  candidate: { bg: "bg-warn-bg", fg: "text-warn", label: "Possible match" },
  error: { bg: "bg-surface-2", fg: "text-ink-3", label: "Error" },
  skipped: { bg: "bg-surface-2", fg: "text-ink-3", label: "Skipped" },
};

export function ScreeningPill({ status }: { status?: ScreeningStatus }) {
  if (!status) return null;
  const s = SCREENING_STYLE[status] ?? SCREENING_STYLE.error;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${s.bg} ${s.fg}`}>
      {s.label}
    </span>
  );
}

/* ---------- Section card ---------- */

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/* ---------- Stat tile ---------- */

export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneFg =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3.5 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneFg}`}>{value}</div>
    </div>
  );
}

/* ---------- Source links ---------- */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceLinks({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.map((u, i) => (
        <a
          key={i}
          href={u}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-brand hover:border-brand-600 hover:bg-brand-50"
          title={u}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path d="M10 14L21 3M21 3h-6M21 3v6M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{hostOf(u)}</span>
        </a>
      ))}
    </div>
  );
}

/* ---------- Inline spinner ---------- */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
