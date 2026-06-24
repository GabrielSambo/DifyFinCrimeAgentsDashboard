"use client";

import { useEffect, useState } from "react";
import type { ScreenSummary } from "@/lib/types";
import type { Client, ClientsResponse } from "@/lib/clients";
import { UboReport } from "./UboReport";
import { UboResults } from "./UboResults";
import { UboCandidates } from "./UboCandidates";
import { Spinner } from "@/components/ui/atoms";
import { HIDE_SCREENING } from "@/lib/flags";
import { useUboInvestigation, type UboFlags, type UseUboInvestigation } from "./useUboInvestigation";

const JURISDICTIONS = [
  "United Kingdom",
  "United States",
  "Germany",
  "Spain",
  "France",
  "Ireland",
  "Luxembourg",
];

const EXAMPLES = [
  { company: "ALDI STORES LIMITED", jurisdiction: "United Kingdom" },
  { company: "BREWDOG PLC", jurisdiction: "United Kingdom" },
];

export interface UboPrefill {
  company: string;
  jurisdiction: string;
  /** bump to retrigger autorun even if company/jurisdiction unchanged */
  nonce?: number;
  autorun?: boolean;
  /** when set, the completed investigation is persisted onto this client. */
  clientId?: string;
  /** the client's latest screening summary, so persisting UBO doesn't downgrade a screening alert. */
  priorScreening?: ScreenSummary | null;
}

/**
 * Explicit "Save to profile" bar shown under a completed full-mode report. When the run was
 * launched from a client profile (prefill.clientId) it's pre-targeted to that client; for an
 * ad-hoc run it offers a client picker so the report can be attached to an existing profile.
 */
function SaveReportBar({ ubo, prefill }: { ubo: UseUboInvestigation; prefill?: UboPrefill }) {
  const linkedId = prefill?.clientId ?? null;
  const [clients, setClients] = useState<Client[]>([]);
  const [picked, setPicked] = useState("");

  // Ad-hoc runs need a client to attach to — load the portfolio for the picker.
  useEffect(() => {
    if (linkedId) return;
    let on = true;
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ClientsResponse) => {
        if (on) setClients(d.clients);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [linkedId]);

  const targetId = linkedId ?? picked;
  const saved = ubo.saveState === "saved";
  const targetName = linkedId
    ? prefill?.company
    : clients.find((c) => c.client_id === picked)?.full_name;

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Save this report to a client profile</div>
          <div className="text-xs text-ink-3">
            {linkedId
              ? <>Will be saved to <span className="font-medium text-ink-2">{prefill?.company}</span></>
              : "Attach this ownership report to an existing client."}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!linkedId && (
            <select
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              disabled={saved}
              className="max-w-[220px] rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-50"
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.client_id} value={c.client_id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => targetId && ubo.saveReport(targetId)}
            disabled={!targetId || ubo.saveState === "saving" || saved}
            className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ubo.saveState === "saving" ? <Spinner /> : null}
            {saved ? "Saved ✓" : "Save to profile"}
          </button>
        </div>
      </div>

      {saved && (
        <p className="mt-2 text-xs font-medium text-good">
          Saved to {targetName ?? "the client profile"}. It will appear under their Beneficial-ownership reports.
        </p>
      )}
      {ubo.saveState === "error" && (
        <p className="mt-2 text-xs font-medium text-bad">Could not save the report. Please try again.</p>
      )}
    </div>
  );
}

export function UboPanel({ prefill }: { prefill?: UboPrefill }) {
  const [company, setCompany] = useState("");
  const [jurisdiction, setJurisdiction] = useState("United Kingdom");
  const depth = 3; // fixed default; no UI control (kyc_lite runs at depth 3)

  // Capability toggles → include_* flags on the UBO agent. Default on (omitted ⇒ runs).
  // PEP/sanctions screening is gated out of scope (HIDE_SCREENING) — defaults off and the toggle is hidden.
  const [includeOwnership, setIncludeOwnership] = useState(true);
  const [includeAdverseMedia, setIncludeAdverseMedia] = useState(true);
  const [includeScreening, setIncludeScreening] = useState(!HIDE_SCREENING);

  const flags: UboFlags = {
    include_ownership: includeOwnership,
    include_adverse_media: includeAdverseMedia,
    include_screening: includeScreening,
  };

  const ubo = useUboInvestigation({
    clientId: prefill?.clientId,
    priorScreening: prefill?.priorScreening,
    // The Ownership tab is built for the full analyst report (markdown narrative + Mermaid
    // ownership diagram + Sources), not the light payload-driven cards the KYC inline run uses.
    mode: "full",
  });

  // Apply a handoff/prefill from elsewhere — resolve (turn 1), then the analyst confirms.
  useEffect(() => {
    if (!prefill) return;
    setCompany(prefill.company);
    setJurisdiction(prefill.jurisdiction);
    if (prefill.autorun && prefill.company) {
      ubo.start({ company: prefill.company, jurisdiction: prefill.jurisdiction, depth, flags });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  const busy = ubo.state === "resolving" || ubo.state === "running";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* Form */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Beneficial-ownership investigation</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Resolves the entity against official registries, then traces the ownership chain to the
          ultimate beneficial owner.
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            ubo.start({ company, jurisdiction, depth, flags });
          }}
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Company name</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. ALDI STORES LIMITED"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Jurisdiction</label>
            <select
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              {JURISDICTIONS.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy || !company.trim()}
              className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Spinner /> : null}
              {ubo.state === "resolving" ? "Searching…" : ubo.state === "running" ? "Investigating…" : "Find entity"}
            </button>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={includeOwnership}
              onChange={(e) => setIncludeOwnership(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Ownership tracing
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={includeAdverseMedia}
              onChange={(e) => setIncludeAdverseMedia(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Adverse media
          </label>
          {!HIDE_SCREENING && (
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={includeScreening}
                onChange={(e) => setIncludeScreening(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              PEP / sanctions screening
            </label>
          )}
        </div>

        {ubo.state === "idle" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.company}
                onClick={() => {
                  setCompany(ex.company);
                  setJurisdiction(ex.jurisdiction);
                }}
                className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-ink-2 hover:border-brand-600 hover:text-brand"
              >
                {ex.company}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Resolving (turn 1) */}
      {ubo.state === "resolving" && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Spinner className="text-brand" />
            Searching registries for matching entities…
          </div>
        </div>
      )}

      {/* Candidate confirmation */}
      {ubo.state === "choosing" && (
        <div className="mt-4">
          <UboCandidates
            key={ubo.choiceNonce}
            candidates={ubo.candidates}
            onSelect={(i) => ubo.selectCandidate(i)}
            onSearchAgain={(t) => ubo.searchAgain(t)}
          />
        </div>
      )}

      {/* Progress (turn 2 investigation) */}
      {ubo.state === "running" && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Spinner className="text-brand" />
            Tracing ownership against official registries…
          </div>
          <ul className="mt-3 space-y-1.5">
            {ubo.progress.length === 0 && (
              <li className="text-xs text-ink-3 animate-veritas-pulse">Resolving entity and querying Companies House…</li>
            )}
            {ubo.progress.map((line, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error */}
      {ubo.state === "error" && ubo.error && (
        <div className="mt-4 rounded-xl border border-bad/30 bg-bad-bg p-5">
          <div className="text-sm font-medium text-bad">Investigation could not complete</div>
          <p className="mt-1 text-sm text-ink-2">{ubo.error}</p>
          <button
            onClick={() => ubo.start({ company, jurisdiction, depth, flags })}
            className="mt-3 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results — structured cards when the agent returned a JSON payload, else the markdown report. */}
      {ubo.state === "done" && ubo.payload && (
        <div className="mt-4">
          <UboResults payload={ubo.payload} />
        </div>
      )}
      {ubo.state === "done" && !ubo.payload && ubo.result?.markdown && (
        <>
          <SaveReportBar ubo={ubo} prefill={prefill} />
          <div className="mt-4">
            <UboReport markdown={ubo.result.markdown} header={ubo.result.header} />
          </div>
        </>
      )}
    </div>
  );
}
