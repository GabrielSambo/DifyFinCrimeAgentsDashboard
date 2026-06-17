/*
  UBO entity disambiguation — pure, dependency-free, safe on server or client.

  When the UBO agent is called WITHOUT a pre-resolved `canonical_name_input`, it
  returns a candidate list so the analyst can confirm exactly which legal entity
  to investigate (e.g. "ALDI" matches 8 distinct entities across registries).
  The answer is markdown of repeated blocks:

    **1. ALDI LIMITED** _(via UK Companies House)_
      - ID: `02333320`
      - Status: active
      - Incorporated: 1989-01-09
      - Address: Holly Lane, Atherstone, Warwickshire, CV9 2SQ
    ...
    Reply with the **number** (e.g., `1`), the company **name**, ...

  This module turns that into structured candidates and detects the disambiguation
  case so the route can branch between a `candidates` and a `done` (report) event.
*/

export interface DisambigCandidate {
  index: number;
  name: string;
  source?: string;
  id?: string;
  status?: string;
  incorporated?: string;
  address?: string;
}

// Header line for one candidate: **<n>. <NAME>** optionally followed by _(via <SOURCE>)_
const HEADER_RE = /\*\*(\d+)\.\s+(.+?)\*\*\s*(?:_\(via\s+(.+?)\)_)?/g;

function field(block: string, label: string): string | undefined {
  const m = new RegExp(`^\\s*[-*]\\s*${label}:\\s*(.+?)\\s*$`, "im").exec(block);
  if (!m) return undefined;
  return m[1].replace(/`/g, "").trim() || undefined;
}

/**
 * Parse the agent's candidate-list answer into structured candidates.
 * Block-iterates by header position so missing/omitted fields degrade to
 * undefined rather than mis-aligning. Only `index` + `name` are required.
 */
export function parseCandidates(answer: string): DisambigCandidate[] {
  const headers: { index: number; name: string; source?: string; start: number; end: number }[] = [];
  HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER_RE.exec(answer)) !== null) {
    headers.push({
      index: Number(m[1]),
      name: m[2].trim(),
      source: m[3]?.trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const out: DisambigCandidate[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const blockEnd = i + 1 < headers.length ? headers[i + 1].start : answer.length;
    const block = answer.slice(h.end, blockEnd);
    if (!h.name) continue;
    out.push({
      index: h.index,
      name: h.name,
      source: h.source,
      id: field(block, "ID"),
      status: field(block, "Status"),
      incorporated: field(block, "Incorporated"),
      address: field(block, "Address"),
    });
  }
  return out;
}

/**
 * True when the answer is a disambiguation candidate list rather than a report.
 * Uses positive signals: the candidate-list sentinel + at least one parsed
 * candidate, and the ABSENCE of a mermaid diagram (reports always contain one).
 * Note: heading shape cannot be used — candidate labels like "1. ALDI LIMITED"
 * collide with the report's numbered section headings.
 */
export function isDisambiguation(answer: string): boolean {
  if (/```mermaid/.test(answer)) return false;
  if (!/reply with the \*{0,2}number/i.test(answer)) return false;
  return parseCandidates(answer).length > 0;
}
