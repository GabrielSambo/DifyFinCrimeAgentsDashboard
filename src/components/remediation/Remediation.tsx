"use client";

import { useCallback, useEffect, useState } from "react";
import { riskRank, type Client, type ClientsResponse } from "@/lib/clients";
import type { ScreenResult } from "@/app/api/screen/route";
import { deriveRisk } from "@/lib/risk";
import { persistCdd, nowIso } from "@/lib/persist-client";
import { Spinner, ReviewBadge } from "@/components/ui/atoms";
import { formatDate } from "@/lib/format";
import { reviewStatus } from "@/lib/review";
import { RequestDocsModal } from "./RequestDocsModal";

/** Anchor date for a client's review cadence: last screened, else onboarding date. */
function reviewAnchor(c: Client): string | null {
  return c.cdd?.last_screened_at ?? c.last_screened ?? c.created_at ?? null;
}

type ScreenState = { status: "idle" | "running" | "done" | "error"; result?: ScreenResult };
type CheckState = { status: "idle" | "checking" | "done"; summary?: string };

function hitCount(r?: ScreenResult): number {
  const s = r?.summary;
  if (!s) return 0;
  return (s.pep_hits || 0) + (s.sanctions_hits || 0) + (s.debarment_hits || 0);
}

/** Human one-liner of the documents2 state after a check: what's on file vs still missing. */
function docCheckSummary(c: Client): string {
  const ds = c.docStatus;
  if (!ds || ds.source === "none") return "No document records on file";
  if (ds.source === "missing_map") {
    return ds.outstanding.length ? `${ds.outstanding.length} document(s) outstanding` : "All documents on file";
  }
  const items = ds.items;
  const validated = items.filter((i) => i.validated).length;
  const received = items.filter((i) => i.received).length;
  return `${validated}/${ds.total} validated · ${received}/${ds.total} received · ${ds.outstanding.length} outstanding`;
}

export function Remediation() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [screens, setScreens] = useState<Record<string, ScreenState>>({});
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [sweeping, setSweeping] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalClient, setModalClient] = useState<Client | null>(null);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const data = (await res.json()) as ClientsResponse;
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rescreen = useCallback(async (c: Client) => {
    setScreens((s) => ({ ...s, [c.client_id]: { status: "running" } }));
    try {
      const res = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: c.full_name,
          entityType: c.profile === "PF" ? "Person" : "Organization",
          jurisdiction: c.jurisdiction ?? "",
        }),
      });
      const result = (await res.json()) as ScreenResult;
      setScreens((s) => ({
        ...s,
        [c.client_id]: { status: result.source === "error" ? "error" : "done", result },
      }));

      // Persist the fresh screen + recomputed risk onto the client record.
      if (result.source === "live" && result.summary) {
        const verdict = deriveRisk(result.summary, c.cdd?.ubo ?? null);
        const at = nowIso();
        await persistCdd(
          c.client_id,
          {
            screening: { summary: result.summary, results: result.results },
            risk_status: verdict.status,
            risk_summary: verdict.summary,
            last_screened_at: at,
          },
          { at, kind: "screen", risk_status: verdict.status, note: verdict.summary },
        );
        // reflect new risk in-memory so the queue badge updates without a reload
        setClients((list) => list.map((x) => (x.client_id === c.client_id ? { ...x, risk: verdict.status, last_screened: at } : x)));
      }
    } catch {
      setScreens((s) => ({ ...s, [c.client_id]: { status: "error" } }));
    }
  }, []);

  // Document check: re-read documents2 (the seeded store) for one client and update the board. This is a
  // pure existence check — what the client already has on file vs what's still missing. NO email, NO upload,
  // NO PEP/sanctions screening (that's rescreen). It trusts documents2.validated (seeded by Agent 2 / JC).
  const checkDocs = useCallback(async (c: Client) => {
    setChecks((s) => ({ ...s, [c.client_id]: { status: "checking" } }));
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const data = (await res.json()) as ClientsResponse;
      const fresh = data.clients.find((x) => x.client_id === c.client_id);
      if (fresh) {
        // Reflect the latest documents2 status on the queue row (lights / outstanding update live).
        setClients((list) => list.map((x) => (x.client_id === c.client_id ? { ...x, docStatus: fresh.docStatus } : x)));
        setChecks((s) => ({ ...s, [c.client_id]: { status: "done", summary: docCheckSummary(fresh) } }));
      } else {
        setChecks((s) => ({ ...s, [c.client_id]: { status: "done", summary: "Client no longer in portfolio" } }));
      }
    } catch {
      setChecks((s) => ({ ...s, [c.client_id]: { status: "done", summary: "Check failed — could not read document records" } }));
    }
  }, []);

  const sweep = useCallback(async () => {
    setSweeping(true);
    // Sequential to be gentle on the OpenSanctions quota during a demo.
    for (const c of clients) {
      await rescreen(c);
    }
    setSweeping(false);
  }, [clients, rescreen]);

  const docsOutstanding = clients.filter((c) => (c.docStatus?.outstanding.length ?? 0) > 0).length;
  const reviewsOverdue = clients.filter((c) => reviewStatus(c.cdd?.review_cadence_days, reviewAnchor(c))?.overdue).length;
  const newlyFlagged = clients.filter((c) => screens[c.client_id]?.status === "done" && hitCount(screens[c.client_id]?.result) > 0).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Remediation &amp; ongoing monitoring</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-3">
            Ongoing review of the existing book — chiefly <span className="font-medium text-ink-2">document remediation</span>.
            <span className="font-medium text-ink-2"> Check documents</span> re-reads what each client has on file vs. what&apos;s
            still missing (no email, no upload); <span className="font-medium text-ink-2">Request documents</span> emails the client
            for the gaps; <span className="font-medium text-ink-2">sanctions re-screening</span> runs alongside since PEP/sanctions
            lists change daily.
          </p>
        </div>
        <button
          onClick={() => void sweep()}
          disabled={sweeping || loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {sweeping ? <Spinner /> : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
          {sweeping ? "Sweeping…" : "Run remediation sweep"}
        </button>
      </div>

      {/* Summary band */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Newly flagged this sweep</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${newlyFlagged ? "text-bad" : "text-good"}`}>{newlyFlagged}</div>
        </div>
      </div>

      {/* Queue */}
      <div className="mt-5 space-y-2.5">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-8 text-sm text-ink-3">
            <Spinner className="text-brand" /> Loading monitoring queue…
          </div>
        ) : (
          clients.map((c) => {
            const st = screens[c.client_id];
            const ck = checks[c.client_id];
            const hits = hitCount(st?.result);
            const outstanding = c.docStatus?.outstanding ?? [];
            const isOpen = expanded.has(c.client_id);
            return (
              <div key={c.client_id} className="rounded-xl border border-border bg-surface px-5 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <button onClick={() => toggleExpand(c.client_id)} className="-m-1 min-w-0 flex-1 rounded-lg p-1 text-left hover:bg-surface-2/60">
                    <div className="flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className={`shrink-0 text-ink-3 transition-transform ${isOpen ? "rotate-90" : ""}`}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="truncate text-sm font-medium text-ink">{c.full_name}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">{c.profile === "PF" ? "Individual" : "Company"}</span>
                      {outstanding.length > 0 && (
                        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium text-warn">{outstanding.length} doc(s) outstanding</span>
                      )}
                    </div>
                    <div className="mt-0.5 ml-5 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                      <span>{c.client_id}</span>
                      <span>Last screened {c.last_screened ? formatDate(c.last_screened) : "never"}</span>
                      <ReviewBadge cadenceDays={c.cdd?.review_cadence_days} anchorIso={reviewAnchor(c)} />
                    </div>
                  </button>

                  <div className="flex items-center gap-3">
                    {ck?.status === "done" && ck.summary && (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2.5 py-1 text-xs font-medium text-ink-2" title="Documents on file (from documents2)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 text-ink-3">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                          <path d="M14 2v6h6M9 15l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {ck.summary}
                      </span>
                    )}
                    {st?.status === "done" && st.result && (
                      hits > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-bad-bg px-2.5 py-1 text-xs font-medium text-bad">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0">
                            <path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                            <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          {st.result.summary?.highest_risk || `${hits} risk topic(s)`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-good-bg px-2.5 py-1 text-xs font-medium text-good">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0">
                            <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Still clear
                        </span>
                      )
                    )}
                    {st?.status === "error" && (
                      <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-3">Screen failed</span>
                    )}
                    <button
                      onClick={() => void checkDocs(c)}
                      disabled={ck?.status === "checking"}
                      title="Re-read the document store: which requested documents are now on file vs still missing. No email, no screening."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      {ck?.status === "checking" ? <Spinner /> : null}
                      {ck?.status === "checking" ? "Checking…" : "Check documents"}
                    </button>
                    <button
                      onClick={() => setModalClient(c)}
                      disabled={outstanding.length === 0}
                      title={outstanding.length === 0 ? "No outstanding documents" : "Request documents from client"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-40"
                    >
                      Request documents
                    </button>
                    <button
                      onClick={() => void rescreen(c)}
                      disabled={st?.status === "running"}
                      title="Sanctions / PEP name screening (OpenSanctions) — separate from documents."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      {st?.status === "running" ? <Spinner /> : null}
                      {st?.status === "running" ? "Screening…" : st ? "Re-screen sanctions" : "Screen sanctions"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Document remediation</div>
                    {outstanding.length > 0 ? (
                      <ul className="mt-1.5 space-y-1 text-sm text-ink-2">
                        {outstanding.map((d, di) => (
                          <li key={di} className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                            {d}
                          </li>
                        ))}
                      </ul>
                    ) : c.docStatus?.source === "none" ? (
                      <p className="mt-1.5 text-sm text-ink-3">No document data captured for this client.</p>
                    ) : (
                      <p className="mt-1.5 text-sm text-ink-3">All required documents on file.</p>
                    )}
                  </div>
                )}

                {st?.status === "done" && hits > 0 && st.result?.summary && (
                  <div className="mt-3 rounded-lg bg-bad-bg/60 px-3 py-2 text-xs text-bad">
                    <span className="font-medium">Remediation required:</span> {st.result.summary.pep_hits} PEP ·{" "}
                    {st.result.summary.sanctions_hits} sanctions · {st.result.summary.debarment_hits} debarment hit(s).
                    Escalate for enhanced due diligence and refresh the client record.
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
