import { useEffect, useState } from "react";

/*
  Escalating loader copy for a long KYC turn. KYC blocks silently — there is no live phase signal
  during the wait (the agent emits nothing until its final answer), so this is honest TIMED
  reassurance, not fabricated progress steps. See PRPs/ai_docs/sse-keepalive-and-timeouts.md.

  Real per-step labels would require the KYC Dify agent to stream intermediate markers (the way the
  UBO agent prints "Ownership search N of M") — tracked as a backend follow-up.
*/

const STEPS: ReadonlyArray<{ at: number; label: string }> = [
  { at: 8_000, label: "Thinking…" },
  { at: 20_000, label: "Running ownership checks (this can take a bit)…" },
  { at: 40_000, label: "Still working — almost there…" },
];

/**
 * Returns an escalating status label while `active` and the bubble has no text yet, else null.
 * `active` = a turn is in flight; `hasText` = the assistant bubble has started streaming.
 */
export function useEscalatingStatus(active: boolean, hasText: boolean): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!active || hasText) return;
    // All setState happens in timer callbacks (never synchronously in the effect body) to satisfy
    // the repo's react-hooks/set-state-in-effect rule. The 0ms reset clears a stale label from a
    // previous turn before the first step fires.
    const reset = setTimeout(() => setLabel(null), 0);
    const timers = STEPS.map((s) => setTimeout(() => setLabel(s.label), s.at));
    return () => {
      clearTimeout(reset);
      timers.forEach(clearTimeout);
    };
  }, [active, hasText]);

  return active && !hasText ? label : null;
}
