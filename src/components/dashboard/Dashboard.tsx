"use client";

import { useCallback, useEffect, useState } from "react";
import { RISK_META, riskRank, type Client, type ClientsResponse, type RiskStatus } from "@/lib/clients";
import { Spinner, TrafficLight, ReviewBadge } from "@/components/ui/atoms";
import { formatDate } from "@/lib/format";

function RiskChip({ risk }: { risk: RiskStatus }) {
  const m = RISK_META[risk];
  const tone =
    m.tone === "bad" ? "bg-bad-bg text-bad" : m.tone === "warn" ? "bg-warn-bg text-warn" : m.tone === "good" ? "bg-good-bg text-good" : "bg-surface-2 text-ink-3";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function StatTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warn" | "bad" }) {
  const fg = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${fg}`}>{value}</div>
    </div>
  );
}

export function Dashboard({ onOpenClient }: { onOpenClient: (c: Client) => void }) {
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const count = (r: RiskStatus) => clients.filter((c) => c.risk === r).length;

  // Document-lifecycle rollups for the second stats group.
  const docPending = clients.filter((c) => (c.docStatus?.outstanding.length ?? 0) > 0).length;
  const docRequested = clients.filter(
    (c) => c.docStatus?.requestedLight === "green" || c.docStatus?.requestedLight === "amber",
  ).length;
  const docComplete = clients.filter(
    (c) => c.docStatus && c.docStatus.total > 0 && c.docStatus.outstanding.length === 0,
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Client portfolio</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Every onboarded client, screened and monitored. Open a case to trace ownership or remediate.
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

      {/* KYC-screening stat tiles */}
      <div className="mt-5 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Risk screening</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total clients" value={clients.length} />
        <StatTile label="PEP / sanctions alerts" value={count("alert")} tone={count("alert") ? "bad" : "default"} />
        <StatTile label="Needs review" value={count("review")} tone={count("review") ? "warn" : "default"} />
        <StatTile label="Cleared" value={count("cleared")} tone="good" />
      </div>

      {/* Document-status stat tiles — same 4-col grid so column edges line up with the row above */}
      <div className="mt-4 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Documents</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Docs pending" value={docPending} tone={docPending ? "warn" : "default"} />
        <StatTile label="Docs requested" value={docRequested} />
        <StatTile label="Docs complete" value={docComplete} tone="good" />
      </div>

      {data?.note && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-3">{data.note}</div>
      )}

      {/* Client table */}
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-[1.6fr_0.6fr_1.1fr_2.5rem_2.5rem_2.5rem_7rem] gap-3 border-b border-border bg-surface-2/50 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          <div>Client</div>
          <div>Type</div>
          <div>KYC Screening</div>
          <div className="text-center" title="Documents requested">Req</div>
          <div className="text-center" title="Documents received">Recv</div>
          <div className="text-center" title="Documents validated">Valid</div>
          <div className="text-right">Last screened</div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-ink-3">
            <Spinner className="text-brand" /> Loading portfolio…
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-sm text-bad">{error}</div>
        ) : clients.length === 0 ? (
          <div className="px-5 py-8 text-sm text-ink-3">No clients yet. Onboard a client to get started.</div>
        ) : (
          clients.map((c) => (
            <button
              key={c.client_id}
              onClick={() => onOpenClient(c)}
              className="grid w-full grid-cols-[1.6fr_0.6fr_1.1fr_2.5rem_2.5rem_2.5rem_7rem] items-start gap-3 border-b border-border px-5 py-3.5 text-left last:border-0 hover:bg-surface-2/60"
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
                <RiskChip risk={c.risk} />
                {c.screening_summary && (
                  <div className="mt-1 truncate text-xs text-ink-3">{c.screening_summary}</div>
                )}
              </div>
              <div className="flex h-5 items-center justify-center"><TrafficLight state={c.docStatus?.requestedLight ?? "unknown"} title="Requested" /></div>
              <div className="flex h-5 items-center justify-center"><TrafficLight state={c.docStatus?.receivedLight ?? "unknown"} title="Received" /></div>
              <div className="flex h-5 items-center justify-center"><TrafficLight state={c.docStatus?.validatedLight ?? "unknown"} title="Validated" /></div>
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
