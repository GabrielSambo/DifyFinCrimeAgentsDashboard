import type { UboPayload, Ubo, ChainNode } from "@/lib/types";
import { ConfidenceBadge, ScreeningPill, SectionCard, Stat, SourceLinks } from "@/components/ui/atoms";
import { HIDE_SCREENING } from "@/lib/flags";

/* ---------- Target identity ---------- */

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return d;
}

function TargetHeader({ p }: { p: UboPayload }) {
  const t = p.target;
  const facts: [string, string | null | undefined][] = [
    ["Company number", t.company_number],
    ["LEI", t.lei],
    ["Legal form", t.legal_form?.toUpperCase()],
    ["Incorporated", fmtDate(t.incorporation_date)],
    ["Jurisdiction", t.jurisdiction],
    ["Registered address", t.registered_address],
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Investigation target</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{t.name}</h2>
          {t.economic_activity && <p className="mt-1 text-sm text-ink-2">{t.economic_activity}</p>}
        </div>
        {!HIDE_SCREENING && t.screening?.status && <ScreeningPill status={t.screening.status} />}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{k}</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{v}</dd>
            </div>
          ))}
      </dl>
      {t.previous_names?.some((n) => n.within_5y) && (
        <div className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
          Previous name(s) within 5 years:{" "}
          {t.previous_names.filter((n) => n.within_5y).map((n) => n.name).join(", ")}
        </div>
      )}
    </div>
  );
}

/* ---------- Screening summary ---------- */

function ScreeningSummary({ p }: { p: UboPayload }) {
  const parties = [p.target, ...(p.ubos ?? [])];
  const screened = parties.length;
  const hits = (p.ubos ?? []).filter((u) => u.screening?.status === "match").length +
    (p.target.screening?.status === "match" ? 1 : 0);
  const possible = (p.ubos ?? []).filter((u) => u.screening?.status === "candidate").length;
  const clearTone = hits > 0 ? "bad" : possible > 0 ? "warn" : "good";
  return (
    <SectionCard title="Screening" subtitle="PEP · Sanctions · Debarment · Adverse media">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Parties screened" value={screened} />
        <Stat label="Confirmed hits" value={hits} tone={hits > 0 ? "bad" : "good"} />
        <Stat label="Possible matches" value={possible} tone={possible > 0 ? "warn" : "default"} />
        <Stat
          label="Adverse media"
          value={p.adverse_media?.length ?? 0}
          tone={(p.adverse_media?.length ?? 0) > 0 ? "warn" : "good"}
        />
      </div>
      <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
        clearTone === "good" ? "bg-good-bg text-good" : clearTone === "warn" ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"
      }`}>
        {clearTone === "good"
          ? "No risk topics identified across screened parties."
          : clearTone === "warn"
            ? "Possible matches require analyst review."
            : "Confirmed screening hits — escalate for enhanced due diligence."}
      </div>
    </SectionCard>
  );
}

/* ---------- Ownership chain ---------- */

function ChainPct({ node }: { node: ChainNode }) {
  if (node.pct_estimate != null) {
    return (
      <span className="text-xs text-ink-2">
        ≈{node.pct_estimate}%{" "}
        {node.pct_confidence && <span className="text-ink-3">({node.pct_confidence})</span>}
      </span>
    );
  }
  if (node.pct_band) return <span className="text-xs text-ink-2">{node.pct_band}</span>;
  return null;
}

function OwnershipChain({ p }: { p: UboPayload }) {
  const chain = p.ownership_chain ?? [];
  const hasParent = !!p.ultimate_parent?.name;
  if (!chain.length && !hasParent) return null;

  return (
    <SectionCard title="Ownership chain" subtitle="Target → intermediaries → ultimate parent">
      <ol className="relative ml-1">
        {chain.map((node, i) => (
          <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
            {i < chain.length - 1 || hasParent ? (
              <span className="absolute left-[7px] top-5 h-full w-px bg-border-strong" />
            ) : null}
            <span className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand bg-surface" />
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{node.entity}</span>
                <ChainPct node={node} />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
                {node.company_number && <span>No. {node.company_number}</span>}
                {node.jurisdiction && <span>{node.jurisdiction}</span>}
                {node.lei && <span className="font-mono">{node.lei}</span>}
              </div>
            </div>
          </li>
        ))}
        {hasParent && (
          <li className="relative flex gap-3">
            <span className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-good bg-good" />
            <div className="min-w-0 flex-1 rounded-lg border border-good/30 bg-good-bg px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-good">Ultimate parent</div>
              <div className="mt-0.5 text-sm font-semibold text-ink">{p.ultimate_parent!.name}</div>
              {p.ultimate_parent!.type && (
                <div className="text-xs text-ink-3 capitalize">{p.ultimate_parent!.type} person/entity</div>
              )}
            </div>
          </li>
        )}
      </ol>
    </SectionCard>
  );
}

/* ---------- Beneficial owner cards ---------- */

function UboCard({ u }: { u: Ubo }) {
  const isNatural = u.type === "natural";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            isNatural ? "bg-brand-50 text-brand" : "bg-surface-2 text-ink-2"
          }`}>
            {isNatural ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 21h18M5 21V5a1 1 0 011-1h8a1 1 0 011 1v16M15 9h3a1 1 0 011 1v11M8 8h2M8 12h2M8 16h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            )}
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink">{u.name}</div>
            <div className="text-xs capitalize text-ink-3">
              {u.role?.replace(/_/g, " ") || (isNatural ? "Natural person" : "Legal entity")}
              {u.jurisdiction ? ` · ${u.jurisdiction}` : ""}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {u.ownership_pct != null && (
            <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand">
              {u.ownership_pct}%
            </span>
          )}
          <ConfidenceBadge level={u.confidence} />
        </div>
      </div>
      {u.ownership_basis && (
        <p className="mt-2.5 text-xs leading-relaxed text-ink-2">{u.ownership_basis}</p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        {!HIDE_SCREENING ? <ScreeningPill status={u.screening?.status} /> : <span />}
        <SourceLinks urls={u.source_urls} />
      </div>
    </div>
  );
}

/* ---------- Compliance (modern slavery + turnover) ---------- */

function ComplianceCard({ p }: { p: UboPayload }) {
  const ms = p.modern_slavery;
  const to = p.turnover;
  if (!ms && !to) return null;
  return (
    <SectionCard title="Compliance" subtitle="Modern Slavery Act s.54 · turnover threshold">
      <div className="space-y-3">
        {to && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-ink">Turnover</div>
              <div className="text-xs text-ink-3">
                {to.method?.replace(/_/g, " ") || "estimate"}
                {to.confidence ? ` · ${to.confidence} confidence` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums text-ink">
                {to.value != null ? `${to.currency ?? "£"}${Intl.NumberFormat().format(to.value)}` : "Not disclosed"}
              </div>
              {to.exceeds_36m != null && (
                <div className={`text-xs ${to.exceeds_36m ? "text-warn" : "text-ink-3"}`}>
                  {to.exceeds_36m ? "Above £36M threshold" : "Below £36M threshold"}
                </div>
              )}
            </div>
          </div>
        )}
        {ms && (
          <div className={`rounded-lg px-3 py-2.5 ${
            ms.compliance_gap ? "bg-bad-bg" : ms.in_scope ? "bg-good-bg" : "bg-surface-2/50"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Modern Slavery statement</span>
              <span className={`text-xs font-medium ${
                ms.compliance_gap ? "text-bad" : ms.in_scope ? "text-good" : "text-ink-3"
              }`}>
                {!ms.in_scope ? "Not in scope" : ms.compliance_gap ? "Gap — no statement" : "Published"}
              </span>
            </div>
            {ms.statements?.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                {s.entity} — {s.year} statement
              </a>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ---------- Adverse media + gaps ---------- */

function AdverseMedia({ p }: { p: UboPayload }) {
  if (!p.adverse_media?.length) return null;
  return (
    <SectionCard title="Adverse media" subtitle={`${p.adverse_media.length} item(s)`}>
      <ul className="space-y-2">
        {p.adverse_media.map((m, i) => (
          <li key={i} className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{m.title || "Untitled"}</span>
              {m.date && <span className="text-xs text-ink-3">{m.date}</span>}
            </div>
            {m.summary && <p className="mt-1 text-xs text-ink-2">{m.summary}</p>}
            {m.url && <SourceLinks urls={[m.url]} />}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* ---------- Top-level results ---------- */

export function UboResults({ payload }: { payload: UboPayload }) {
  const naturalUbos = (payload.ubos ?? []).filter((u) => u.type === "natural");
  const ubos = payload.ubos ?? [];
  return (
    <div className="space-y-4">
      <TargetHeader p={payload} />

      {payload.summary && (
        <div className="rounded-xl border border-border bg-brand-50/40 px-5 py-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-brand">Analyst summary</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{payload.summary}</p>
        </div>
      )}

      {!HIDE_SCREENING && <ScreeningSummary p={payload} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <OwnershipChain p={payload} />
        <ComplianceCard p={payload} />
      </div>

      <SectionCard
        title="Beneficial owners & controllers"
        subtitle={`${ubos.length} part${ubos.length === 1 ? "y" : "ies"}${naturalUbos.length ? ` · ${naturalUbos.length} natural person(s)` : ""}`}
      >
        {ubos.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {ubos.map((u, i) => (
              <UboCard key={i} u={u} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">No beneficial owners identified.</p>
        )}
      </SectionCard>

      <AdverseMedia p={payload} />

      {payload.information_gaps?.length ? (
        <SectionCard title="Information gaps">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {payload.information_gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {payload.iterations_used != null && (
        <p className="text-center text-xs text-ink-3">
          Investigation completed in {payload.iterations_used} ownership search iteration(s).
        </p>
      )}
    </div>
  );
}
