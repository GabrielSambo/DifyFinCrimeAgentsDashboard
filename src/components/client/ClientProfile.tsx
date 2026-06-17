"use client";

import { useState } from "react";
import { RISK_META, type Client } from "@/lib/clients";
import { normalizeUboPayload } from "@/lib/ubo-normalize";
import { UboResults } from "@/components/ubo/UboResults";
import { SectionCard, Stat, Spinner } from "@/components/ui/atoms";
import { persistCdd } from "@/lib/persist-client";
import { formatDate } from "@/lib/format";
import { reviewStatus } from "@/lib/review";

function RiskHeader({ client }: { client: Client }) {
  const status = client.cdd?.risk_status ?? client.risk;
  const m = RISK_META[status];
  const tone = m.tone === "bad" ? "bg-bad-bg text-bad" : m.tone === "warn" ? "bg-warn-bg text-warn" : m.tone === "good" ? "bg-good-bg text-good" : "bg-surface-2 text-ink-3";
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Client</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{client.full_name}</h2>
          <div className="mt-0.5 text-xs text-ink-3">
            {client.client_id} · {client.profile === "PF" ? "Individual" : "Company"}
            {client.jurisdiction ? ` · ${client.jurisdiction}` : ""}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          {m.label}
        </span>
      </div>
      <p className="mt-3 text-sm text-ink-2">{client.cdd?.risk_summary ?? client.screening_summary ?? "Not yet screened."}</p>
      <div className="mt-1 text-xs text-ink-3">
        Last screened: {client.cdd?.last_screened_at || client.last_screened ? formatDate(client.cdd?.last_screened_at ?? client.last_screened) : "never"}
      </div>
    </div>
  );
}

function ReviewCadenceCard({ client }: { client: Client }) {
  const [days, setDays] = useState<string>(client.cdd?.review_cadence_days?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Count from the last screening; fall back to onboarding date when never screened.
  const anchor = client.cdd?.last_screened_at ?? client.last_screened ?? client.created_at ?? null;
  const n = days.trim() === "" ? null : Number(days);
  const rs = reviewStatus(n && n > 0 ? n : null, anchor);
  const toneFg = rs?.tone === "bad" ? "text-bad" : rs?.tone === "warn" ? "text-warn" : "text-ink-3";

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await persistCdd(client.client_id, { review_cadence_days: n && n > 0 ? n : null });
    setSaving(false);
    if (res.ok) setSaved(true);
    else setError(res.note ?? "Save failed — not persisted");
  }

  return (
    <SectionCard title="Review cadence" subtitle="How often this client should be re-reviewed">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Review every (days)</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => { setDays(e.target.value); setSaved(false); }}
            placeholder="e.g. 180"
            className="mt-1 w-32 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </label>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {rs && <span className={`text-sm font-medium ${toneFg}`}>{rs.label}</span>}
        {saved && <span className="text-xs text-good">Saved</span>}
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
      {!anchor && (
        <p className="mt-2 text-xs text-ink-3">Not screened yet — the due date starts counting from the first screening.</p>
      )}
    </SectionCard>
  );
}

function IdentityCard({ client }: { client: Client }) {
  const entries = Object.entries(client.data ?? {}).filter(
    ([k, v]) => k !== "cdd" && typeof v === "string" && (v as string).trim(),
  ) as [string, string][];
  return (
    <SectionCard title="Identity" subtitle="KYC intake record">
      {entries.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {entries.slice(0, 12).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{k}</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-3">No structured intake fields captured.</p>
      )}
    </SectionCard>
  );
}

function ScreeningCard({ client }: { client: Client }) {
  const s = client.cdd?.screening?.summary;
  if (!s) {
    return (
      <SectionCard title="Screening" subtitle="PEP · Sanctions · Debarment">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-3">Not yet screened. Run a sweep from the Remediation tab.</p>
        </div>
      </SectionCard>
    );
  }
  const hits = (s.pep_hits || 0) + (s.sanctions_hits || 0) + (s.debarment_hits || 0);
  return (
    <SectionCard title="Screening" subtitle="PEP · Sanctions · Debarment">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Screened" value={s.screened ?? 0} />
        <Stat label="PEP hits" value={s.pep_hits ?? 0} tone={s.pep_hits ? "bad" : "good"} />
        <Stat label="Sanctions" value={s.sanctions_hits ?? 0} tone={s.sanctions_hits ? "bad" : "good"} />
        <Stat label="Debarment" value={s.debarment_hits ?? 0} tone={s.debarment_hits ? "bad" : "good"} />
      </div>
      <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${hits ? "bg-bad-bg text-bad" : "bg-good-bg text-good"}`}>
        {hits ? `🚨 ${s.highest_risk || `${hits} risk topic(s) — escalate for EDD`}` : "✅ No screening hits"}
      </div>
    </SectionCard>
  );
}

export function ClientProfile({
  client,
  onInvestigate,
  investigating,
}: {
  client: Client;
  onInvestigate: (c: Client) => void;
  investigating?: boolean;
}) {
  const ubo = normalizeUboPayload(client.cdd?.ubo ?? null);
  const isCompany = client.profile !== "PF";

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
      <RiskHeader client={client} />

      <div className="grid gap-4 lg:grid-cols-2">
        <IdentityCard client={client} />
        <ScreeningCard client={client} />
      </div>

      <ReviewCadenceCard client={client} />

      {/* Ownership / due diligence */}
      <SectionCard
        title="Beneficial ownership"
        subtitle={ubo ? "Latest investigation" : isCompany ? "Not yet investigated" : "Individual — ownership tracing N/A"}
        right={
          isCompany ? (
            <button
              onClick={() => onInvestigate(client)}
              disabled={investigating}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {investigating ? <Spinner /> : null}
              {ubo ? "Re-run due diligence" : "Run due diligence"}
            </button>
          ) : undefined
        }
      >
        {ubo ? (
          <UboResults payload={ubo} />
        ) : (
          <p className="text-sm text-ink-3">
            {isCompany
              ? "Run a beneficial-ownership investigation to trace this company's UBOs and screen every party."
              : "Beneficial-ownership tracing applies to company clients. This individual is screened directly (see Screening above)."}
          </p>
        )}
      </SectionCard>

      {/* History */}
      {client.cdd?.history?.length ? (
        <SectionCard title="Due-diligence history">
          <ul className="space-y-1.5">
            {client.cdd.history.slice(0, 8).map((h, i) => (
              <li key={i} className="flex items-center gap-3 text-xs">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-3">{h.kind}</span>
                <span className="text-ink-2">{h.note}</span>
                <span className="ml-auto text-ink-3">{h.at?.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
