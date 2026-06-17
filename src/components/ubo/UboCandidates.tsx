"use client";

import { useState } from "react";
import type { DisambigCandidate } from "@/lib/types";

/*
  Entity confirmation step. Before spending minutes on a full investigation, the
  analyst confirms exactly which legal entity to trace — a search like "ALDI"
  can match many distinct entities across registries. Selecting a card runs the
  investigation on that entity; "search again" re-queries with a refined name.
*/

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const active = /^active/.test(s);
  const tone = active ? "bg-good-bg text-good" : "bg-surface-2 text-ink-3";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}

function CandidateCard({
  c,
  onSelect,
  disabled,
}: {
  c: DisambigCandidate;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="group w-full rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-brand hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{c.name}</div>
          {c.source && <div className="mt-0.5 text-[11px] text-ink-3">via {c.source}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={c.status} />
          <span className="text-ink-3 transition-transform group-hover:translate-x-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {c.id && (
          <div className="min-w-0">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-3">ID</dt>
            <dd className="truncate font-mono text-xs text-ink" title={c.id}>{c.id}</dd>
          </div>
        )}
        {c.incorporated && (
          <div className="min-w-0">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-3">Incorporated</dt>
            <dd className="truncate text-xs text-ink">{c.incorporated}</dd>
          </div>
        )}
        {c.address && (
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-3">Address</dt>
            <dd className="truncate text-xs text-ink" title={c.address}>{c.address}</dd>
          </div>
        )}
      </dl>
    </button>
  );
}

export function UboCandidates({
  candidates,
  onSelect,
  onSearchAgain,
  disabled,
}: {
  candidates: DisambigCandidate[];
  onSelect: (index: number) => void;
  onSearchAgain: (text: string) => void;
  disabled?: boolean;
}) {
  const [refine, setRefine] = useState("");
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Confirm the entity to investigate</h2>
      <p className="mt-0.5 text-xs text-ink-3">
        {candidates.length} matching {candidates.length === 1 ? "entity" : "entities"} found across registries.
        Select the correct one — the full investigation runs on your choice.
      </p>

      <div className="mt-4 space-y-2.5">
        {candidates.map((c) => (
          <CandidateCard key={`${c.index}-${c.id ?? c.name}`} c={c} disabled={disabled} onSelect={() => onSelect(c.index)} />
        ))}
      </div>

      <form
        className="mt-4 flex items-center gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (refine.trim()) onSearchAgain(refine.trim());
        }}
      >
        <span className="text-xs text-ink-3">Not the right entity?</span>
        <input
          value={refine}
          onChange={(e) => setRefine(e.target.value)}
          placeholder="Search again with a more specific name…"
          disabled={disabled}
          className="flex-1 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !refine.trim()}
          className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Search
        </button>
      </form>
    </div>
  );
}
