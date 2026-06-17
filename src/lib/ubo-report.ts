/*
  Full-mode UBO report helpers — pure, dependency-free, safe on server or client.

  The agent's `mode=full` answer is a 9-section markdown report prefixed with
  "Ownership search N of 3 completed." progress lines. This module strips the
  progress prefix, builds a section table-of-contents, and best-effort extracts
  a small structured header (subject / company number / LEI / screening) for the
  at-a-glance strip above the report. Every field is optional and degrades to
  undefined — the authoritative data always remains in the rendered markdown.
*/

const PROGRESS_RE = /Ownership search \d+ of \d+ completed\.?/g;

export interface ScreeningCounts {
  entities?: number;
  pep?: number;
  sanctions?: number;
  debarment?: number;
  matches?: number;
  candidates?: number;
}

export interface UboReportHeader {
  subject?: string;
  jurisdiction?: string;
  companyNumber?: string;
  lei?: string;
  incorporated?: string;
  address?: string;
  status?: string;
  screening?: ScreeningCounts;
  /** true when no PEP/sanctions/debarment/match hits were found across screened parties */
  clear?: boolean;
}

export interface TocEntry {
  id: string;
  label: string;
}

export interface UboReportResult {
  conversationId: string;
  messageId: string;
  /** The full markdown report with progress lines removed. */
  markdown: string;
  header: UboReportHeader;
}

/** Remove the streamed "Ownership search N of 3 completed." progress prefix lines. */
export function stripProgress(answer: string): string {
  return answer.replace(PROGRESS_RE, "").replace(/^\s+/, "");
}

/** Stable, collision-light slug used for both heading ids and TOC anchors. */
export function slugify(text: string): string {
  return text
    .replace(/[*_`#]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "section";
}

/** Clean inline markdown emphasis from a heading label for display. */
function cleanLabel(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

/**
 * A top-level report section, detected by its numbered prefix rather than its
 * heading level — the agent emits the 9 sections as `## ` on some runs and
 * `### ` on others, so level alone is unreliable. Matches "1. Executive
 * Summary" … "9. …" and the "Section 9: …" variant.
 */
export function isSectionHeading(label: string): boolean {
  const t = cleanLabel(label);
  return /^\d+\.\s+\S/.test(t) || /^Section\s+\d+\s*[:.]/i.test(t);
}

/** Build the section TOC from every numbered top-level heading (levels 2-4). */
export function tocFromMarkdown(markdown: string): TocEntry[] {
  const out: TocEntry[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const label = cleanLabel(m[2]);
    if (!label || !isSectionHeading(label)) continue;
    let id = slugify(label);
    let n = 2;
    while (seen.has(id)) id = `${slugify(label)}-${n++}`;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

function num(re: RegExp, s: string): number | undefined {
  const m = re.exec(s);
  return m ? Number(m[1]) : undefined;
}

function str(re: RegExp, s: string): string | undefined {
  const m = re.exec(s);
  return m ? m[1].trim() : undefined;
}

/** Best-effort structured header for the at-a-glance strip. All fields optional. */
export function extractReportHeader(markdown: string): UboReportHeader {
  const subject =
    str(/\*\*Subject\*\*:\s*(.+)/, markdown) ??
    str(/Company:\s*(.+?)\s*\(/, markdown);

  const jurisdiction = str(/\*\*Jurisdiction\*\*:\s*(.+)/, markdown);

  const companyNumber =
    str(/Company:\s*.+?\((\d{6,8})\)/, markdown) ??
    str(/\/company\/(\d{6,8})/, markdown);

  const lei =
    str(/search\.gleif\.org\/#\/record\/([A-Z0-9]{18,20})/, markdown) ??
    str(/\bLEI\b[^A-Z0-9]{0,12}([A-Z0-9]{20})\b/, markdown);

  // "- Date of incorporation: 1989-01-09" / "- **Registered address**: ..."
  // Labels appear with or without bold markers across runs.
  const incorporated = str(/[-*]\s*\*{0,2}Date of incorporation\*{0,2}:\s*(.+)/i, markdown);
  const address = str(/[-*]\s*\*{0,2}Registered address\*{0,2}:\s*(.+)/i, markdown);

  // "Status: PROVISIONAL" / "Status: VERIFIED" (may carry trailing ** from bold)
  const status = str(/Status:\s*\**([A-Z][A-Z ]+?)\**\s*(?:\n|$)/, markdown);

  const screening: ScreeningCounts = {
    entities: num(/\*\*Entities screened\*\*:\s*(\d+)/, markdown),
    pep: num(/\*\*PEP hits\*\*:\s*(\d+)/, markdown),
    sanctions: num(/\*\*Sanctions hits\*\*:\s*(\d+)/, markdown),
    debarment: num(/\*\*Debarment hits\*\*:\s*(\d+)/, markdown),
    matches: num(/\*\*Matches\*\*:\s*(\d+)/, markdown),
    candidates: num(/\*\*Candidates\*\*:\s*(\d+)/, markdown),
  };
  const hasScreening = Object.values(screening).some((v) => v !== undefined);
  // "clear" reflects risk topics only. A name `match` with no PEP/sanctions/
  // debarment hit is the agent's "name matches (no risk topics)" case — not a
  // risk signal — so it must NOT flip the chip to red.
  const clear = hasScreening
    ? (screening.pep ?? 0) === 0 &&
      (screening.sanctions ?? 0) === 0 &&
      (screening.debarment ?? 0) === 0
    : undefined;

  return {
    subject,
    jurisdiction,
    companyNumber,
    lei,
    incorporated,
    address,
    status,
    screening: hasScreening ? screening : undefined,
    clear,
  };
}
