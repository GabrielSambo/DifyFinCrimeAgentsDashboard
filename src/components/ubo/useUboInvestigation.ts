"use client";

import { useEffect, useRef, useState } from "react";
import type { UboReportResult, DisambigCandidate, UboPayload, ScreenSummary } from "@/lib/types";
import { deriveRisk } from "@/lib/risk";
import { persistCdd, nowIso } from "@/lib/persist-client";
import { parseSse } from "@/lib/sse";
import { HIDE_SCREENING } from "@/lib/flags";

/*
  The UBO investigation run state machine, extracted from UboPanel so the standalone
  Ownership & Screening tab AND the inline KYC findings card share ONE implementation
  (two-turn disambiguation, SSE streaming, optional persist). Behaviour is identical to
  the original UboPanel logic — only the include_* flags and the persist target are now
  parameters instead of component-local state.

  Two conversations never cross: this hook owns the UBO conversationId; the KYC chat keeps
  its own. Persist is opt-in (pass clientId) — the KYC inline run passes none, so it never
  writes to a client record.
*/

type DoneData = UboReportResult & { payload?: UboPayload | null };

export type UboRunState = "idle" | "resolving" | "choosing" | "running" | "done" | "error";

export interface UboFlags {
  include_ownership: boolean;
  include_adverse_media: boolean;
  include_screening: boolean;
}

const DEFAULT_FLAGS: UboFlags = {
  include_ownership: true,
  include_adverse_media: true,
  // PEP/sanctions screening is out of scope (HIDE_SCREENING) — don't run it on the UBO agent.
  include_screening: !HIDE_SCREENING,
};

export interface UseUboInvestigation {
  state: UboRunState;
  progress: string[];
  result: UboReportResult | null;
  payload: UboPayload | null;
  error: string | null;
  candidates: DisambigCandidate[];
  choiceNonce: number;
  /** Turn 1 — resolve a typed name to candidate entities (sets the run going). */
  start(args: { company: string; jurisdiction: string; depth: number; flags?: UboFlags }): void;
  /** Turn 2 — run the full investigation on the chosen candidate index. */
  selectCandidate(index: number): void;
  /** Re-disambiguate on the same conversation with a refined name. */
  searchAgain(text: string): void;
  /** Re-run the last start() seed (used by the error/retry affordance). */
  retry(): void;
  /** Clear back to idle (aborts any in-flight run). */
  reset(): void;
}

export function useUboInvestigation(opts?: {
  clientId?: string;
  priorScreening?: ScreenSummary | null;
  /**
   * Which version of the UBO agent to invoke. The standalone Ownership tab opts into
   * "full" (the analyst markdown report + Mermaid ownership diagram); the inline KYC run
   * leaves this unset and keeps the light, payload-driven path. Fixed per mount.
   */
  mode?: "kyc_lite" | "full";
}): UseUboInvestigation {
  const [state, setState] = useState<UboRunState>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<UboReportResult | null>(null);
  const [payload, setPayload] = useState<UboPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DisambigCandidate[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [choiceNonce, setChoiceNonce] = useState(0);
  const [autoIndex, setAutoIndex] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Flags + seed chosen at start() are frozen for the lifetime of the conversation, so a
  // mid-investigation change can't desync turn-2 / search-again from turn-1's entity resolution.
  const flagsRef = useRef<UboFlags>(DEFAULT_FLAGS);
  const seedRef = useRef<{ company: string; jurisdiction: string; depth: number }>({
    company: "",
    jurisdiction: "United Kingdom",
    depth: 3,
  });

  // Single-candidate auto-advance — run after the candidates state has committed so
  // conversationId is available, never synchronously mid-stream.
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
    runOpts: { phase: "resolving" | "running" },
  ) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState(runOpts.phase);
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
            // Enrichment loop: persist the investigation onto the active client (opt-in).
            if (r.payload && opts?.clientId) {
              const verdict = deriveRisk(opts.priorScreening ?? null, r.payload);
              const at = nowIso();
              void persistCdd(
                opts.clientId,
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
        mode: opts?.mode ?? "kyc_lite",
        include_ownership: flagsRef.current.include_ownership,
        include_adverse_media: flagsRef.current.include_adverse_media,
        include_screening: flagsRef.current.include_screening,
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
        jurisdiction: seedRef.current.jurisdiction,
        depth: seedRef.current.depth,
        mode: opts?.mode ?? "kyc_lite",
        conversationId,
        query: String(selection),
        include_ownership: flagsRef.current.include_ownership,
        include_adverse_media: flagsRef.current.include_adverse_media,
        include_screening: flagsRef.current.include_screening,
      },
      { phase: "running" },
    );
  }

  // "Search again" from the picker — re-disambiguate on the same conversation.
  function searchAgain(text: string) {
    if (!conversationId) {
      void resolve(text, seedRef.current.jurisdiction, seedRef.current.depth);
      return;
    }
    setCandidates([]);
    return streamRun(
      {
        jurisdiction: seedRef.current.jurisdiction,
        depth: seedRef.current.depth,
        mode: opts?.mode ?? "kyc_lite",
        conversationId,
        query: text,
        include_ownership: flagsRef.current.include_ownership,
        include_adverse_media: flagsRef.current.include_adverse_media,
        include_screening: flagsRef.current.include_screening,
      },
      { phase: "resolving" },
    );
  }

  function start(args: { company: string; jurisdiction: string; depth: number; flags?: UboFlags }) {
    flagsRef.current = args.flags ?? DEFAULT_FLAGS;
    seedRef.current = { company: args.company, jurisdiction: args.jurisdiction, depth: args.depth };
    void resolve(args.company, args.jurisdiction, args.depth);
  }

  function reset() {
    abortRef.current?.abort();
    setState("idle");
    setProgress([]);
    setResult(null);
    setPayload(null);
    setError(null);
    setCandidates([]);
    setConversationId(null);
  }

  return {
    state,
    progress,
    result,
    payload,
    error,
    candidates,
    choiceNonce,
    start,
    selectCandidate: (index: number) => void investigate(index),
    searchAgain: (text: string) => void searchAgain(text),
    retry: () => void resolve(seedRef.current.company, seedRef.current.jurisdiction, seedRef.current.depth),
    reset,
  };
}
