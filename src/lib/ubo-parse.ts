import type { UboPayload, UboRunResult, Candidate } from "./types";

/**
 * The UBO agent streams a single `answer` string shaped like:
 *
 *   Ownership search 1 of 3 completed.Ownership search 2 of 3 completed.
 *   ## UBO Investigation — Structured Output
 *   ...markdown narrative (screening summary)...
 *   ```json
 *   { ...UboPayload... }
 *   ```
 *
 * When `canonical_name_input` is empty, turn 1 returns no JSON and instead lists
 * candidate companies for the analyst to choose from. This module untangles all
 * three layers (progress / narrative / payload) without throwing.
 */

const PROGRESS_RE = /Ownership search \d+ of \d+ completed\.?/g;
const JSON_FENCE_RE = /```json\s*([\s\S]*?)```/i;

export function extractProgress(answer: string): string[] {
  return (answer.match(PROGRESS_RE) ?? []).map((s) => s.trim().replace(/\.$/, ""));
}

/** Pull the first ```json fenced block and JSON.parse it. Returns null on any failure. */
export function extractPayload(answer: string): { payload: UboPayload | null; error?: string } {
  const m = answer.match(JSON_FENCE_RE);
  if (!m) return { payload: null };
  try {
    return { payload: JSON.parse(m[1].trim()) as UboPayload };
  } catch (e) {
    return { payload: null, error: e instanceof Error ? e.message : "JSON parse failed" };
  }
}

/** Everything that isn't a progress line or the JSON fence — the readable summary. */
export function extractNarrative(answer: string): string {
  return answer
    .replace(JSON_FENCE_RE, "")
    .replace(PROGRESS_RE, "")
    .replace(/Machine-readable JSON payload below\.?/i, "")
    .trim();
}

/**
 * Heuristic disambiguation detector. The agent presents candidates as a numbered
 * or bulleted list with no JSON block. We only treat it as disambiguation when
 * there is no payload AND the text reads like a choice list.
 */
function detectCandidates(narrative: string, hasPayload: boolean): Candidate[] {
  if (hasPayload) return [];
  const looksLikeChoice = /\b(did you mean|which|select|choose|candidate|matches?)\b/i.test(narrative);
  if (!looksLikeChoice) return [];
  const lines = narrative.split("\n");
  const out: Candidate[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:\*\*)?(\d+)(?:\*\*)?[.)]\s+(.*\S)/);
    if (m) out.push({ index: Number(m[1]), raw: m[2].replace(/\*\*/g, "").trim() });
  }
  return out;
}

export function parseUboAnswer(
  answer: string,
  meta: { conversationId: string; messageId: string },
): UboRunResult {
  const progress = extractProgress(answer);
  const { payload, error } = extractPayload(answer);
  const narrative = extractNarrative(answer);
  const candidates = detectCandidates(narrative, !!payload);
  return {
    conversationId: meta.conversationId,
    messageId: meta.messageId,
    payload,
    narrative,
    progress,
    awaitingDisambiguation: candidates.length > 0,
    candidates,
    rawAnswer: answer,
    parseError: error,
  };
}
