/*
  Turns the live KYC agent's free-text replies into clickable options, so the
  analyst clicks instead of typing "1" / "2". This is a *frontend rendering*
  layer over the unchanged agent — it never blocks anything: if we can't confidently
  detect options, we render nothing and the user just types.

  Two shapes are detected, plus one curated special case:
    • the entity-type menu  ("1) Individual … 2) Company (Legal Entity)")
    • generic numbered menus ("1) … 2) …")
    • bulleted/bold profile lists ("- **Private company** – …")
*/

export interface Option {
  label: string;
  /** What we actually send to the agent when the option is clicked. */
  value: string;
  hint?: string;
}

export interface DetectedOptions {
  kind: "entity" | "numbered" | "bulleted" | "none";
  options: Option[];
}

const NUMBERED_RE = /^\s*(\d+)[).]\s+(.*\S)\s*$/;
const BULLET_BOLD_RE = /^\s*[-*•]\s+\*\*(.+?)\*\*\s*(?:[–\-—:]\s*(.*))?$/;

/** The first onboarding fork. The agent wants "1 salaried" / "1 self-employed" / "2". */
function detectEntityMenu(text: string): DetectedOptions | null {
  const t = text.toLowerCase();
  const hasIndividual = /individual|natural person|persona\s+(f[ií]sica|natural)/.test(t);
  const hasCompany = /legal entity|company|persona\s+jur[ií]dica/.test(t);
  if (!hasIndividual || !hasCompany) return null;

  const mentionsSalaried = /salaried|asalariad/.test(t);
  const mentionsSelf = /self-?employed|aut[óo]nom|self employed/.test(t);

  const options: Option[] = [];
  if (mentionsSalaried) options.push({ label: "Individual — Salaried", value: "1 salaried" });
  if (mentionsSelf) options.push({ label: "Individual — Self-employed", value: "1 self-employed" });
  if (!mentionsSalaried && !mentionsSelf) options.push({ label: "Individual", value: "1" });
  options.push({ label: "Company (Legal Entity)", value: "2" });
  return { kind: "entity", options };
}

function detectNumbered(text: string): Option[] {
  const out: Option[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(NUMBERED_RE);
    if (m) {
      // Strip a trailing "— description" so the button label stays short.
      const label = m[2].replace(/\s*[–—-]\s.*$/, "").replace(/\*\*/g, "").trim();
      out.push({ label, value: m[1] });
    }
  }
  return out.length >= 2 ? out : [];
}

function detectBulletBold(text: string): Option[] {
  const out: Option[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(BULLET_BOLD_RE);
    if (m) {
      const label = m[1].replace(/\s*\(.*?\)\s*/g, "").trim(); // drop "(e.g., …)"
      out.push({ label, value: m[1].trim(), hint: m[2]?.trim() });
    }
  }
  return out.length >= 2 ? out : [];
}

/**
 * A fill-in template (e.g. "Please fill in this template … 1. Basic identification …
 * 1.1 Full legal name: ____") is NOT a menu. Detecting it as options is the bug that
 * turned a click into a stray "1" and corrupted the entity name downstream.
 */
function isFillInTemplate(text: string): boolean {
  return (
    /_{3,}/.test(text) || // ____ blanks
    /fill in (this|the) template/i.test(text) ||
    /rellena|complete? (este|the) (plantilla|template)/i.test(text) ||
    /\b\d+\.\d+\b/.test(text) // sub-numbered items like "1.1", "2.3"
  );
}

/** Only surface clickable choices when the agent is actually asking the user to pick one. */
function hasSelectionIntent(text: string): boolean {
  return /\b(choose|select|pick|which one|reply with|desired profile|please choose|elija|elige|seleccione|escoja)\b/i.test(
    text,
  );
}

export function detectOptions(text: string): DetectedOptions {
  // The entity fork is a known, stable menu — always safe to render.
  const entity = detectEntityMenu(text);
  if (entity) return entity;

  // Never turn a fill-in template into single-select buttons.
  if (isFillInTemplate(text)) return { kind: "none", options: [] };

  // Otherwise only render options when the agent is asking the user to choose.
  if (!hasSelectionIntent(text)) return { kind: "none", options: [] };

  const numbered = detectNumbered(text);
  if (numbered.length) return { kind: "numbered", options: numbered };

  const bulleted = detectBulletBold(text);
  if (bulleted.length) return { kind: "bulleted", options: bulleted };

  return { kind: "none", options: [] };
}

/** Extract a bulleted/numbered list of required documents for the checklist card. */
export function detectDocuments(text: string): string[] {
  const t = text.toLowerCase();
  const looksLikeDocs = /document|documentaci[óo]n|required|requerid|provide|aporta|adjunta|upload/.test(t);
  if (!looksLikeDocs) return [];
  const docs: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*•]\s+(.*\S)\s*$/);
    if (m && !BULLET_BOLD_RE.test(line)) docs.push(m[1].replace(/\*\*/g, "").trim());
  }
  return docs.length >= 2 ? docs : [];
}
