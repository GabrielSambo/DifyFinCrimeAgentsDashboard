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

/* ── Fill-in template → interactive form ──────────────────────────────────────
   The agent sends a plain-text template ("Please fill in this template … 1.1 Full
   legal name: ____") and ALREADY prefills what it knows (the value after each colon
   IS the prefill). We turn each line into a typed field so the frontend renders inputs
   instead of making the analyst copy-paste. The reply parser (LLM_ExtractClientInfo)
   is tolerant of "Label: Value" lines, so submitting them back needs no backend change.
*/

export interface TemplateField {
  /** Canonical label (numbering stripped) — used verbatim in the submit payload. */
  label: string;
  /** Label with date-format / "(if known)" hints stripped — what the analyst sees. */
  displayLabel: string;
  /** Prefill value; "" when the source line was a blank (____ / N/A / …). */
  value: string;
  type: "text" | "date";
}

export interface DetectedTemplate {
  /** The agent's lead-in text (everything before the first field line). */
  preamble: string;
  fields: TemplateField[];
}

// Strict gate: the fill-in template ALWAYS opens with this phrase (DSL-enforced).
// We must NOT reuse the loose isFillInTemplate() here — it fires on any "0.75"-style
// decimal, which would turn screening summaries ("- PEP hits: 1") into a form.
const TEMPLATE_PHRASE_RE =
  /fill in (?:this|the) template|rellen[ae].*plantilla|complet[ae].*plantilla/i;

// Optional numbering ("1.", "1.1", "2)") or bullet prefix, then "Label: value".
const FIELD_LINE_RE = /^\s*(?:\d+(?:\.\d+)*[.)]?\s+|[-*•]\s+)?(.+?):\s*(.*)$/;
const NUMBER_OR_BULLET_PREFIX_RE = /^\s*(?:\d+(?:\.\d+)*[.)]?\s+|[-*•]\s+)/;
const BLANK_RE = /^(?:_+|—+|-+|n\/?a|tbd|\(blank\)|\.\.\.|…)$/i;
// Date type only when the label itself is a date field ("Date of …", "… date",
// "Fecha de …"). We test with parentheticals removed so "Country of Incorporation"
// stays text and a grouped "Identity document (…, expiry date)" stays a single text box.
const DATE_LABEL_RE = /\b(?:date|fecha|birth|nacimiento)\b/i;
// Trailing hint qualifiers to drop from the displayed label only.
const HINT_RE =
  /\s*\((?:DD\/MM\/YYYY|D{1,2}\/M{1,2}\/Y{2,4}|if known|optional|si se conoce|opcional)[^)]*\)\s*$/i;

/** DD/MM/YYYY → YYYY-MM-DD for the native date input; "" if not representable. */
export function toDateInputValue(v: string): string {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

/** YYYY-MM-DD → DD/MM/YYYY for the submit payload; passthrough otherwise. */
export function fromDateInputValue(v: string): string {
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v.trim();
}

/**
 * Parse a fill-in template into typed fields + the agent's lead-in text.
 * Returns no fields (→ frontend falls back to plain text) unless this is clearly a
 * template with ≥2 fields, so we never break a normal chat message.
 */
export function detectTemplate(text: string): DetectedTemplate {
  if (!TEMPLATE_PHRASE_RE.test(text)) return { preamble: "", fields: [] };

  const lines = text.split("\n");
  const fields: TemplateField[] = [];
  let firstFieldIdx = -1;

  lines.forEach((line, i) => {
    const m = line.match(FIELD_LINE_RE);
    if (!m) return;
    const label = m[1].trim();
    const rawValue = m[2].trim();
    const hasPrefix = NUMBER_OR_BULLET_PREFIX_RE.test(line);
    const isBlank = rawValue === "" || BLANK_RE.test(rawValue);
    // Precision guard: only numbered/bulleted lines or explicit blanks are fields.
    // Drops prose like "Note: leave blank if unknown".
    if (!hasPrefix && !isBlank) return;
    if (!label) return;

    const value = isBlank ? "" : rawValue;
    const labelForType = label.replace(/\([^)]*\)/g, " ");
    let type: TemplateField["type"] = DATE_LABEL_RE.test(labelForType) ? "date" : "text";
    // If a date prefill can't be normalized, fall back to text so we never lose it.
    if (type === "date" && value && !toDateInputValue(value)) type = "text";

    if (firstFieldIdx === -1) firstFieldIdx = i;
    fields.push({ label, displayLabel: label.replace(HINT_RE, "").trim(), value, type });
  });

  if (fields.length < 2) return { preamble: "", fields: [] };
  const preamble = lines.slice(0, firstFieldIdx).join("\n").trim();
  return { preamble, fields };
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
