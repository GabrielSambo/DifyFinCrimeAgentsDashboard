"use client";

import { useCallback, useEffect, useState } from "react";
import { riskRank, type Client, type ClientsResponse } from "@/lib/clients";
import { Spinner, ReviewBadge } from "@/components/ui/atoms";
import { formatDate } from "@/lib/format";
import { reviewStatus } from "@/lib/review";
import { RequestDocsModal } from "./RequestDocsModal";

/** Anchor date for a client's review cadence: last reviewed, else onboarding date. */
function reviewAnchor(c: Client): string | null {
  return c.cdd?.last_screened_at ?? c.last_screened ?? c.created_at ?? null;
}

/*
  Document lifecycle, grouped by what the client HAS vs HASN'T:
    • On file & good   — validated
    • Received         — received but not yet validated (pending analyst review)
    • Outstanding      — not received yet (awaiting the client, or never requested)
  documents2 clients carry per-document labels for every stage; missing_map clients only
  know the outstanding labels + a total, so the "on file" bucket is a count without labels.
*/
type DocGroups = {
  validatedCount: number;
  validatedLabels: string[];
  receivedCount: number;
  receivedLabels: string[];
  outstandingCount: number;
  outstandingLabels: string[];
  total: number;
  /** true when we have per-document labels for every stage (documents2). */
  detailed: boolean;
};

function groupDocs(c: Client): DocGroups {
  const empty: DocGroups = {
    validatedCount: 0, validatedLabels: [], receivedCount: 0, receivedLabels: [],
    outstandingCount: 0, outstandingLabels: [], total: 0, detailed: false,
  };
  const ds = c.docStatus;
  if (!ds || ds.source === "none" || ds.total === 0) return empty;

  if (ds.source === "documents2" && ds.items.length > 0) {
    const validatedLabels = ds.items.filter((i) => i.validated).map((i) => i.label);
    const receivedLabels = ds.items.filter((i) => i.received && !i.validated).map((i) => i.label);
    const outstandingLabels = ds.items.filter((i) => !i.received).map((i) => i.label);
    return {
      validatedCount: validatedLabels.length, validatedLabels,
      receivedCount: receivedLabels.length, receivedLabels,
      outstandingCount: outstandingLabels.length, outstandingLabels,
      total: ds.total, detailed: true,
    };
  }

  // missing_map (or documents2 with no rows): only outstanding labels + total are known.
  const outstandingLabels = ds.outstanding;
  const onFile = Math.max(0, ds.total - outstandingLabels.length);
  return {
    validatedCount: onFile, validatedLabels: [],
    receivedCount: 0, receivedLabels: [],
    outstandingCount: outstandingLabels.length, outstandingLabels,
    total: ds.total, detailed: false,
  };
}

/** One-line summary under the client name. */
function summaryLine(g: DocGroups): string {
  if (g.total === 0) return "";
  if (g.detailed) {
    return `${g.validatedCount}/${g.total} validated · ${g.receivedCount} received · ${g.outstandingCount} outstanding`;
  }
  return `${g.validatedCount}/${g.total} on file · ${g.outstandingCount} outstanding`;
}

/** Relative "x ago", real-time to the second. Client-only (guarded by a non-null timestamp). */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 3) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** Segmented progress bar: validated (green) · received (amber) · outstanding (red). */
function DocProgress({ g }: { g: DocGroups }) {
  const pct = (n: number) => (g.total ? (n / g.total) * 100 : 0);
  return (
    <div className="flex h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-surface-2" title={summaryLine(g)}>
      <div className="bg-good" style={{ width: `${pct(g.validatedCount)}%` }} />
      <div className="bg-warn" style={{ width: `${pct(g.receivedCount)}%` }} />
      <div className="bg-bad" style={{ width: `${pct(g.outstandingCount)}%` }} />
    </div>
  );
}

/** One status group in the expanded panel (rendered only when it has documents). */
function DocGroup({
  tone, title, count, labels, emptyNote,
}: { tone: "good" | "warn" | "bad"; title: string; count: number; labels: string[]; emptyNote?: string }) {
  if (count === 0) return null;
  const dot = tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-bad";
  const text = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-bad";
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${text}`}>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {title} ({count})
      </div>
      {labels.length > 0 ? (
        <div className="mt-1.5 ml-3.5 flex flex-wrap gap-1.5">
          {labels.map((l, i) => (
            <span key={i} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-ink-2">
              {l}
            </span>
          ))}
        </div>
      ) : (
        emptyNote && <div className="mt-1 ml-3.5 text-xs text-ink-3">{emptyNote}</div>
      )}
    </div>
  );
}

export function Remediation() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);       // first load only (blanks the list)
  const [refreshing, setRefreshing] = useState(false); // global "Refresh now" — keeps the list, flashes all cards
  const [checking, setChecking] = useState<Record<string, boolean>>({}); // per-client re-check in flight
  const [checkedAt, setCheckedAt] = useState<Record<string, number>>({}); // per-client last re-check time
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalClient, setModalClient] = useState<Client | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [, setTick] = useState(0); // forces a re-render so the "x ago" label stays fresh

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Re-read the whole document store. Three modes:
  //   "initial" — first paint, blanks the list with a spinner.
  //   "refresh" — the big "Refresh now" button: keeps the list visible, flashes EVERY card as "Checking…"
  //               then stamps them all "Updated just now" (the bulk-refresh demo moment).
  //   "silent"  — the 60s background auto-check: no visible flash, just re-stamps freshness.
  const load = useCallback(async (mode: "initial" | "refresh" | "silent" = "initial") => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const fetchData = fetch("/api/clients", { cache: "no-store" }).then((r) => r.json() as Promise<ClientsResponse>);
      // Hold the "Checking…" state briefly on a manual refresh so the bulk re-pull reads as real work.
      const [data] = await Promise.all([
        fetchData,
        mode === "refresh" ? new Promise((r) => setTimeout(r, 700)) : Promise.resolve(),
      ]);
      // Remediation only applies to existing clients — a brand-new client mid-onboarding has nothing to
      // remediate (2026-06-06 daily). New clients live in the Onboarding/KYC view instead.
      const existing = data.clients.filter((c) => c.client_type === "existing");
      // Remediation queue: most documents outstanding first, then by risk.
      const ordered = [...existing].sort(
        (a, b) =>
          (b.docStatus?.outstanding.length ?? 0) - (a.docStatus?.outstanding.length ?? 0) ||
          riskRank(a.risk) - riskRank(b.risk),
      );
      setClients(ordered);
      const now = Date.now();
      setLastChecked(now);
      // Only an explicit "Refresh now" press stamps the per-card "✓ Updated" badges (the wow reveal).
      // Initial load and the silent background poll NEVER pre-populate them — the board lands clean, and
      // the stamps only appear (and tick in real time) once a button is pressed.
      if (mode === "refresh") {
        setCheckedAt(Object.fromEntries(ordered.map((c) => [c.client_id, now])));
      }
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "refresh") setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  // Autonomous feel: re-read the document store quietly in the background, and keep the "x ago" label live.
  useEffect(() => {
    const poll = setInterval(() => { void load("silent"); }, 60_000);
    const tick = setInterval(() => setTick((t) => t + 1), 1_000); // keep the "Xs ago" stamps live
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  // Per-client refresh: re-read this client's documents from the store and update the breakdown above (the
  // 🟢/🟡/🔴 groups + progress bar are the single source of truth). Auto-expands the card so the refreshed
  // status is visible. NO email, NO upload — a pure re-read of documents2.
  const checkDocs = useCallback(async (c: Client) => {
    setChecking((s) => ({ ...s, [c.client_id]: true }));
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const data = (await res.json()) as ClientsResponse;
      const fresh = data.clients.find((x) => x.client_id === c.client_id);
      if (fresh) {
        setClients((list) => list.map((x) => (x.client_id === c.client_id ? { ...x, docStatus: fresh.docStatus } : x)));
      }
      setCheckedAt((s) => ({ ...s, [c.client_id]: Date.now() }));
      setExpanded((prev) => new Set(prev).add(c.client_id)); // reveal the refreshed breakdown
    } finally {
      setChecking((s) => ({ ...s, [c.client_id]: false }));
    }
  }, []);

  const docsOutstanding = clients.filter((c) => (c.docStatus?.outstanding.length ?? 0) > 0).length;
  const reviewsOverdue = clients.filter((c) => reviewStatus(c.cdd?.review_cadence_days, reviewAnchor(c))?.overdue).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Remediation &amp; ongoing monitoring</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-3">
            Ongoing review of the existing book — chiefly <span className="font-medium text-ink-2">document remediation</span>.
            <span className="font-medium text-ink-2"> Check documents</span> re-reads what each client has on file vs. what&apos;s
            still missing; <span className="font-medium text-ink-2">Request documents</span> emails the client for the gaps.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-good animate-veritas-pulse" />
            Documents auto-checked · {lastChecked ? `last refreshed ${agoLabel(lastChecked)}` : "checking…"}
          </span>
          <button
            onClick={() => void load("refresh")}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {refreshing ? <Spinner /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {/* Summary band */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">In monitoring</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{clients.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Docs outstanding</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${docsOutstanding ? "text-warn" : "text-good"}`}>{docsOutstanding}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Reviews overdue</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${reviewsOverdue ? "text-bad" : "text-ink"}`}>{reviewsOverdue}</div>
        </div>
      </div>

      {/* Queue */}
      <div className="mt-5 space-y-2.5">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-8 text-sm text-ink-3">
            <Spinner className="text-brand" /> Loading monitoring queue…
          </div>
        ) : clients.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-5 py-8 text-sm text-ink-3">
            No existing clients in monitoring yet.
          </div>
        ) : (
          clients.map((c) => {
            // A global "Refresh now" marks every card busy → all flash "Checking…" then "Updated just now".
            const busy = !!checking[c.client_id] || refreshing;
            const updatedAt = checkedAt[c.client_id];
            const g = groupDocs(c);
            const isOpen = expanded.has(c.client_id);
            return (
              <div key={c.client_id} className="rounded-xl border border-border bg-surface px-5 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <button onClick={() => toggleExpand(c.client_id)} className="-m-1 min-w-0 flex-1 rounded-lg p-1 text-left hover:bg-surface-2/60">
                    <div className="flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className={`shrink-0 text-ink-3 transition-transform ${isOpen ? "rotate-90" : ""}`}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="truncate text-sm font-medium text-ink">{c.full_name}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">{c.profile === "PF" ? "Individual" : "Company"}</span>
                      {g.outstandingCount > 0 && (
                        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium text-warn">{g.outstandingCount} outstanding</span>
                      )}
                    </div>
                    {/* progress + summary */}
                    {g.total > 0 && (
                      <div className="mt-1.5 ml-5 flex items-center gap-2.5">
                        <DocProgress g={g} />
                        <span className="truncate text-xs text-ink-2">{summaryLine(g)}</span>
                      </div>
                    )}
                    <div className="mt-1 ml-5 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                      <span>{c.client_id}</span>
                      <span>Last reviewed {c.last_screened ? formatDate(c.last_screened) : "never"}</span>
                      <ReviewBadge cadenceDays={c.cdd?.review_cadence_days} anchorIso={reviewAnchor(c)} />
                    </div>
                  </button>

                  <div className="flex items-center gap-3">
                    {!busy && updatedAt && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-good" title="This client's documents were just re-read from the store">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0">
                          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Updated {agoLabel(updatedAt)}
                      </span>
                    )}
                    <button
                      onClick={() => void checkDocs(c)}
                      disabled={busy}
                      title="Re-read this client's documents from the store and refresh the breakdown above. No email."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      {busy ? <Spinner /> : null}
                      {busy ? "Checking…" : "Check documents"}
                    </button>
                    <button
                      onClick={() => setModalClient(c)}
                      disabled={g.outstandingCount === 0}
                      title={g.outstandingCount === 0 ? "No outstanding documents" : "Request documents from client"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-40"
                    >
                      Request documents
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface-2/40 px-4 py-3">
                    {g.total === 0 ? (
                      <p className="text-sm text-ink-3">No document data captured for this client.</p>
                    ) : (
                      <>
                        <DocGroup tone="good" title="On file & good" count={g.validatedCount} labels={g.validatedLabels}
                          emptyNote={`${g.validatedCount} document(s) on file — per-document detail not tracked for this client.`} />
                        <DocGroup tone="warn" title="Received — pending review" count={g.receivedCount} labels={g.receivedLabels} />
                        <DocGroup tone="bad" title="Still outstanding" count={g.outstandingCount} labels={g.outstandingLabels} />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {modalClient && (
        <RequestDocsModal
          client={modalClient}
          outstanding={modalClient.docStatus?.outstanding ?? []}
          onClose={() => setModalClient(null)}
          onSent={() => { void checkDocs(modalClient); /* re-read documents2 so the board reflects the request */ }}
        />
      )}
    </div>
  );
}
