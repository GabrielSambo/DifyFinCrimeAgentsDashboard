"use client";

import { useCallback, useEffect, useState } from "react";
import { riskRank, type Client, type ClientsResponse } from "@/lib/clients";
import { docPhase, validatedCount } from "@/lib/documents";
import { Spinner, DocStatusBadge, ReviewBadge } from "@/components/ui/atoms";
import { formatDate } from "@/lib/format";

function StatTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warn" | "bad" }) {
  const fg = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${fg}`}>{value}</div>
    </div>
  );
}

type Segment = "all" | "new" | "existing";

export function Dashboard({ onOpenClient }: { onOpenClient: (c: Client) => void }) {
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as ClientsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clients = [...(data?.clients ?? [])].sort((a, b) => riskRank(a.risk) - riskRank(b.risk));

  // New vs Existing is defined by document status (the old client_type heuristic was unreliable):
  // "existing" = fully validated (file complete); "new" = still being collected (requested/pending/none).
  const isExisting = (c: Client) => docPhase(c.docStatus) === "validated";
  const nNew = clients.filter((c) => !isExisting(c)).length;
  const nExisting = clients.filter((c) => isExisting(c)).length;
  const visible =
    segment === "all" ? clients : clients.filter((c) => (segment === "existing" ? isExisting(c) : !isExisting(c)));

  // Document-phase rollups for the portfolio stat tiles — one vocabulary across the whole dashboard.
  const docRequested = clients.filter((c) => docPhase(c.docStatus) === "requested").length;
  const docPending = clients.filter((c) => docPhase(c.docStatus) === "pending").length;
  const docValidated = clients.filter((c) => docPhase(c.docStatus) === "validated").length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Client portfolio</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Every onboarded client, with live document status and ongoing monitoring. Open a case to trace ownership or remediate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${data.source === "live" ? "bg-good-bg text-good" : "bg-surface-2 text-ink-3"}`}>
              {data.source === "live" ? "Live · Supabase" : "Demo data"}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {loading ? <Spinner /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Portfolio stat tiles — document-completeness is the headline, not screening. */}
      <div className="mt-5 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Portfolio</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total clients" value={clients.length} />
        <StatTile label="Requested" value={docRequested} tone={docRequested ? "bad" : "default"} />
        <StatTile label="Pending" value={docPending} tone={docPending ? "warn" : "default"} />
        <StatTile label="Validated" value={docValidated} tone="good" />
      </div>

      {data?.note && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-3">{data.note}</div>
      )}

      {/* New / Existing segment — by document status: existing = fully validated, new = still being collected */}
      <div className="mt-5 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 w-fit text-xs font-medium">
        {([
          ["all", `All · ${clients.length}`],
          ["new", `New · ${nNew}`],
          ["existing", `Existing · ${nExisting}`],
        ] as [Segment, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSegment(id)}
            className={`rounded-md px-3 py-1 transition-colors ${segment === id ? "bg-brand text-white" : "text-ink-3 hover:bg-surface-2"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Client table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-[1.6fr_0.7fr_1.6fr_7rem] gap-3 border-b border-border bg-surface-2/50 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          <div>Client</div>
          <div>Type</div>
          <div>Document status</div>
          <div className="text-right">Review</div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-ink-3">
            <Spinner className="text-brand" /> Loading portfolio…
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-sm text-bad">{error}</div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-8 text-sm text-ink-3">
            {segment === "all" ? "No clients yet. Onboard a client to get started." : `No ${segment} clients.`}
          </div>
        ) : (
          visible.map((c) => (
            <button
              key={c.client_id}
              onClick={() => onOpenClient(c)}
              className="grid w-full grid-cols-[1.6fr_0.7fr_1.6fr_7rem] items-start gap-3 border-b border-border px-5 py-3.5 text-left last:border-0 hover:bg-surface-2/60"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{c.full_name}</div>
                <div className="truncate text-xs text-ink-3">
                  {c.client_id}
                  {c.jurisdiction ? ` · ${c.jurisdiction}` : ""}
                </div>
              </div>
              <div className="min-w-0 truncate text-xs text-ink-3">{c.profile === "PF" ? "Individual" : "Company"}</div>
              <div className="min-w-0">
                <DocStatusBadge ds={c.docStatus} />
                {c.docStatus && c.docStatus.total > 0 && (
                  <div className="mt-1 truncate text-xs text-ink-3">
                    {validatedCount(c.docStatus)} of {c.docStatus.total} validated
                    {c.docStatus.outstanding.length > 0 ? ` · ${c.docStatus.outstanding.slice(0, 2).join(", ")}` : ""}
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-ink-3">
                {formatDate(c.last_screened)}
                <div className="mt-0.5">
                  <ReviewBadge cadenceDays={c.cdd?.review_cadence_days} anchorIso={c.cdd?.last_screened_at ?? c.last_screened ?? c.created_at} />
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
