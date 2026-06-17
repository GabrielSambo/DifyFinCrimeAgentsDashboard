"use client";

import { useEffect, useRef, useState } from "react";
import type { UboReportResult, DisambigCandidate, UboPayload, ScreenSummary } from "@/lib/types";
import { UboReport } from "./UboReport";
import { UboResults } from "./UboResults";
import { UboCandidates } from "./UboCandidates";
import { Spinner } from "@/components/ui/atoms";
import { deriveRisk } from "@/lib/risk";
import { persistCdd, nowIso } from "@/lib/persist-client";

type DoneData = UboReportResult & { payload?: UboPayload | null };

type RunState = "idle" | "resolving" | "choosing" | "running" | "done" | "error";

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

export function UboPanel({ prefill }: { prefill?: UboPrefill }) {
  const [company, setCompany] = useState("");
  const [jurisdiction, setJurisdiction] = useState("United Kingdom");
  const [depth, setDepth] = useState(3);

  // Capability toggles → include_* flags on the UBO agent. Default on (omitted ⇒ runs).
  const [includeOwnership, setIncludeOwnership] = useState(true);
  const [includeAdverseMedia, setIncludeAdverseMedia] = useState(true);
  const [includeScreening, setIncludeScreening] = useState(true);

  const [state, setState] = useState<RunState>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<UboReportResult | null>(null);
  const [payload, setPayload] = useState<UboPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DisambigCandidate[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [choiceNonce, setChoiceNonce] = useState(0);
  const [autoIndex, setAutoIndex] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Apply a handoff from the KYC panel — resolve (turn 1), then the analyst confirms.
  useEffect(() => {
    if (!prefill) return;
    setCompany(prefill.company);
    setJurisdiction(prefill.jurisdiction);
    if (prefill.autorun && prefill.company) {
      void resolve(prefill.company, prefill.jurisdiction, depth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  // Single-candidate auto-advance — run after the candidates state has committed
  // so conversationId is available, never synchronously mid-stream.
  useEffect(() => {
    if (autoIndex == null) return;
    const idx = autoIndex;
    setAutoIndex(null);
    void investigate(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoIndex]);

  function handleCandidates(data: { conversationId?: string; candidates?: DisambigCandidate[] }) {
    const cid = data.conversationId || "";
    const cands = data.candidates ?? [];
    if (!cid || cands.length === 0) {
      setState("error");
      setError("Could not resolve the entity. Try a more specific company name.");
      return;
    }
    setConversationId(cid);
    setCandidates(cands);
    if (cands.length === 1) {
      // Unambiguous — skip the picker and investigate the sole match.
      setAutoIndex(cands[0].index);
    } else {
      setChoiceNonce((n) => n + 1);
      setState("choosing");
    }
  }

  async function streamRun(
    body: Record<string, unknown>,
    opts: { phase: "resolving" | "running" },
  ) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState(opts.phase);
    setProgress([]);
    setResult(null);
    setPayload(null);
    setError(null);

    let sawTerminal = false;
    try {
      const res = await fetch("/api/ubo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const ev = parseSse(block);
          if (!ev) continue;
          if (ev.event === "progress") {
            setProgress((p) => [...p, (ev.data as { text: string }).text]);
          } else if (ev.event === "candidates") {
            sawTerminal = true;
            handleCandidates(ev.data as { conversationId?: string; candidates?: DisambigCandidate[] });
          } else if (ev.event === "done") {
            sawTerminal = true;
            const r = ev.data as DoneData;
            setResult(r);
            setPayload(r.payload ?? null);
            // Enrichment loop: persist the investigation onto the active client.
            if (r.payload && prefill?.clientId) {
              const verdict = deriveRisk(prefill.priorScreening ?? null, r.payload);
              const at = nowIso();
              void persistCdd(
                prefill.clientId,
                {
                  ubo: r.payload,
                  ubo_resolved_name: r.payload.target?.name,
                  risk_status: verdict.status,
                  risk_summary: verdict.summary,
                  last_screened_at: at,
                },
                { at, kind: "ubo", risk_status: verdict.status, note: `Ownership traced: ${r.payload.target?.name ?? ""}` },
              );
            }
            if (r.payload || r.markdown?.trim()) setState("done");
            else {
              setState("error");
              setError("The agent did not return a report. Try again or refine the company name.");
            }
          } else if (ev.event === "error") {
            sawTerminal = true;
            setState("error");
            setError((ev.data as { message: string }).message);
          }
        }
      }
      // Stream ended without a terminal event.
      if (!sawTerminal) {
        setState((s) => (s === "resolving" || s === "running" ? "error" : s));
        setError((e) => e ?? "The connection ended before a result. Please retry.");
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState("error");
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  // Turn 1 — resolve the typed name to candidate entities (no canonicalName).
  function resolve(name: string, j: string, d: number) {
    if (!name.trim()) return;
    setCandidates([]);
    setConversationId(null);
    return streamRun(
      {
        company: name.trim(),
        jurisdiction: j,
        depth: d,
        mode: "kyc_lite",
        include_ownership: includeOwnership,
        include_adverse_media: includeAdverseMedia,
        include_screening: includeScreening,
      },
      { phase: "resolving" },
    );
  }

  // Turn 2 — run the full investigation on the chosen entity (same conversation).
  function investigate(selection: number | string) {
    if (!conversationId) {
      setState("error");
      setError("Lost the disambiguation session. Please start a new search.");
      return;
    }
    return streamRun(
      {
        jurisdiction,
        depth,
        mode: "kyc_lite",
        conversationId,
        query: String(selection),
        include_ownership: includeOwnership,
        include_adverse_media: includeAdverseMedia,
        include_screening: includeScreening,
      },
      { phase: "running" },
    );
  }

  // "Search again" from the picker — re-disambiguate on the same conversation.
  function searchAgain(text: string) {
    if (!conversationId) {
      void resolve(text, jurisdiction, depth);
      return;
    }
    setCandidates([]);
    return streamRun(
      {
        jurisdiction,
        depth,
        mode: "kyc_lite",
        conversationId,
        query: text,
        include_ownership: includeOwnership,
        include_adverse_media: includeAdverseMedia,
        include_screening: includeScreening,
      },
      { phase: "resolving" },
    );
  }

  const busy = state === "resolving" || state === "running";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* Form */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Beneficial-ownership investigation</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Resolves the entity against official registries, then traces the ownership chain to the
          ultimate beneficial owner and screens every party.
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void resolve(company, jurisdiction, depth);
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
              {state === "resolving" ? "Searching…" : state === "running" ? "Investigating…" : "Find entity"}
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
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={includeScreening}
              onChange={(e) => setIncludeScreening(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            PEP / sanctions screening
          </label>
        </div>

        {state === "idle" && (
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
      {state === "resolving" && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Spinner className="text-brand" />
            Searching registries for matching entities…
          </div>
        </div>
      )}

      {/* Candidate confirmation */}
      {state === "choosing" && (
        <div className="mt-4">
          <UboCandidates
            key={choiceNonce}
            candidates={candidates}
            onSelect={(i) => void investigate(i)}
            onSearchAgain={(t) => void searchAgain(t)}
          />
        </div>
      )}

      {/* Progress (turn 2 investigation) */}
      {state === "running" && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Spinner className="text-brand" />
            Tracing ownership against official registries…
          </div>
          <ul className="mt-3 space-y-1.5">
            {progress.length === 0 && (
              <li className="text-xs text-ink-3 animate-veritas-pulse">Resolving entity and querying Companies House…</li>
            )}
            {progress.map((line, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error */}
      {state === "error" && error && (
        <div className="mt-4 rounded-xl border border-bad/30 bg-bad-bg p-5">
          <div className="text-sm font-medium text-bad">Investigation could not complete</div>
          <p className="mt-1 text-sm text-ink-2">{error}</p>
          <button
            onClick={() => void resolve(company, jurisdiction, depth)}
            className="mt-3 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results — structured cards when the agent returned a JSON payload, else the markdown report. */}
      {state === "done" && payload && (
        <div className="mt-4">
          <UboResults payload={payload} />
        </div>
      )}
      {state === "done" && !payload && result?.markdown && (
        <div className="mt-4">
          <UboReport markdown={result.markdown} header={result.header} />
        </div>
      )}
    </div>
  );
}

function parseSse(block: string): { event: string; data: unknown } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
