/*
  Maps a UBO kyc_lite payload onto KYC onboarding template fields, so a one-click "Auto-fill
  from registries" can pre-fill the company profile. Pure + dependency-free.

  Matches each template field by key+label regex (mirrors prefillFor in KycChat) to a value on
  the resolved UBO `target`. ONLY emits facts the registry sources provide — never regulation
  status, source of funds, or source of wealth (judgments / unsourced; see field-coverage map).
  Per-field provenance (real source_url per field) is a Phase-B Dify enhancement; Phase A attaches
  a single derived source label + best-effort URL.
*/

import type { UboPayload } from "@/lib/types";

export interface FieldSuggestion {
  value: string;
  /** Chip label, e.g. "Companies House" / "GLEIF" / "Registry". */
  source?: string;
  sourceUrl?: string;
  confidence?: "high" | "medium" | "low";
}

interface FieldLike {
  key: string;
  label: string;
  type: "text" | "date" | "boolean";
}

export interface AddressParts {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
}

const UK_POSTCODE = /\b[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}\b/i;
const US_ZIP = /\b\d{5}(?:-\d{4})?\b/;

/**
 * Best-effort split of a flat registry address string into structured parts. NEVER fabricates:
 * the whole string always lands in line1 (safe default); only postal/country are pulled out when a
 * pattern confidently identifies them. city/region/line2 stay blank unless a registry supplies real
 * parts (see the attribute-lookup `parts` path). Pure + dependency-free.
 */
export function parseAddress(flat: string): AddressParts {
  const s = (flat ?? "").trim();
  if (!s) return {};
  const out: AddressParts = { line1: s };
  const tokens = s.split(",").map((t) => t.trim()).filter(Boolean);

  // Postal code: first token containing a UK postcode or US ZIP.
  for (const tok of tokens) {
    const m = tok.match(UK_POSTCODE) ?? tok.match(US_ZIP);
    if (m) {
      out.postal = m[0].toUpperCase().replace(/\s+/g, " ");
      break;
    }
  }
  // Country: last token if it reads as a country word (alphabetic, no digits) and isn't the postal.
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (/^[A-Za-z][A-Za-z .'-]+$/.test(last) && !UK_POSTCODE.test(last) && !US_ZIP.test(last)) {
      out.country = last;
    }
  }
  return out;
}

function sourceLabel(p: UboPayload): string {
  const t = p.target;
  const j = (t.jurisdiction ?? "").toLowerCase();
  if (t.company_number && /united kingdom|\buk\b|england|wales|scotland/.test(j)) return "Companies House";
  if (t.company_number) return "Company registry";
  if (t.lei) return "GLEIF";
  return "Registry";
}

/**
 * Returns suggestions keyed by template field key. A field is skipped (no entry) when the UBO
 * target has nothing to offer for it, or when it's a judgment/unsourced field we must not auto-fill.
 */
export function suggestionsFromUbo(
  payload: UboPayload,
  fields: FieldLike[],
): Record<string, FieldSuggestion> {
  const t = payload.target;
  if (!t) return {};
  const source = sourceLabel(payload);
  const firstUrl = payload.ubos?.find((u) => u.source_urls?.length)?.source_urls?.[0];
  // Registry gives ONE address string → split best-effort once, reuse across the six sub-fields.
  const ap = parseAddress(t.registered_address ?? "");

  const out: Record<string, FieldSuggestion> = {};
  for (const f of fields) {
    const l = `${f.key} ${f.label}`.toLowerCase();

    // Never auto-fill judgments / unsourced facts (regulation, listing, intermediaries, source of funds/wealth).
    if (/regulat|listing|listed|intermediar|source.?of.?funds|source.?of.?wealth|\bwealth\b|\bfunds?\b/.test(l)) continue;

    let value: string | undefined;
    const k = f.key.toLowerCase();
    if (/^(?:res_)?address_/.test(k)) {
      // Structured address sub-fields. The registry returns ONE string → best-effort split (parseAddress),
      // never fabricated: whole string → line1, postal/country pulled out by pattern; city/region/line2
      // stay blank here (registry-exact parts arrive via the per-field 🔍 attribute lookup).
      if (/_line1$/.test(k)) value = ap.line1 ?? t.registered_address ?? undefined;
      else if (/_line2$/.test(k)) value = ap.line2 ?? undefined;
      else if (/_city$/.test(k)) value = ap.city ?? undefined;
      else if (/_region$/.test(k)) value = ap.region ?? undefined;
      else if (/_postal$/.test(k)) value = ap.postal ?? undefined;
      else if (/_country$/.test(k)) value = ap.country ?? t.jurisdiction ?? undefined;
    } else if (/address|registered.?office|domicil/.test(l)) value = t.registered_address ?? undefined;
    else if (/registration|reg\.?\s*(no|number)|company.?number|\blei\b|\bcif\b|\bnif\b|\bvat\b/.test(l))
      value = t.company_number ?? t.lei ?? undefined;
    else if (/legal.?form|forma.?legal|entity.?type|company.?type/.test(l)) value = t.legal_form ?? undefined;
    else if (f.type === "date" || /incorporat.*date|date.*incorporat|constituc/.test(l)) value = t.incorporation_date ?? undefined;
    else if (/country|jurisdic|pa[ií]s/.test(l)) value = t.jurisdiction ?? undefined;
    else if (/activity|activ|business|economic|\bsic\b|sector/.test(l))
      value = t.economic_activity ?? (t.sic_codes?.length ? t.sic_codes.join(", ") : undefined);
    else if (/legal.?name|full.?name|company.?name|\bname\b|nombre|raz[oó]n social/.test(l)) value = t.name ?? undefined;

    if (value && value.trim()) {
      out[f.key] = { value: value.trim(), source, sourceUrl: firstUrl, confidence: "high" };
    }
  }
  return out;
}

/** The single attributes the attribute-lookup agent can resolve. */
export type LookupAttribute =
  | "registered_address"
  | "legal_form"
  | "incorporation_date"
  | "sic_code"
  | "status"
  | "is_listed"
  | "is_regulated"
  | "listing_exchange"
  | "listing_ticker"
  | "listing_isin";

/**
 * Toggle/listing fields that ARE fetchable from the attribute app (Wikidata listing, web-fallback
 * regulation) — exempt from the judgment guard below. Everything else matching the guard (regulator
 * detail, intermediaries, source of funds/wealth) stays manual.
 */
const FETCHABLE_JUDGMENT = new Set<string>([
  "is_listed",
  "is_regulated",
  "listing_exchange",
  "listing_ticker",
  "listing_isin",
]);

/**
 * Reverse of suggestionsFromUbo's match: which single attribute a template field maps to for the
 * per-field re-search (🔍). Returns null for identity anchors (name / country / registration number,
 * which are resolved once) and for judgment/unsourced fields — those get no re-search affordance.
 */
export function attributeForField(field: { key: string; label: string }): LookupAttribute | null {
  const l = `${field.key} ${field.label}`.toLowerCase();
  // Block judgment/unsourced fields UNLESS they're an explicitly-fetchable toggle/listing key.
  if (
    !FETCHABLE_JUDGMENT.has(field.key) &&
    /regulat|listing|listed|intermediar|source.?of.?funds|source.?of.?wealth|\bwealth\b|\bfunds?\b/.test(l)
  )
    return null;
  // Fetchable toggles/listing detail (matched by exact key — the labels are too varied to regex).
  if (field.key === "is_listed") return "is_listed";
  if (field.key === "is_regulated") return "is_regulated";
  if (field.key === "listing_exchange") return "listing_exchange";
  if (field.key === "listing_ticker") return "listing_ticker";
  if (field.key === "listing_isin") return "listing_isin";
  if (/address|registered.?office|domicil/.test(l)) return "registered_address";
  if (/legal.?form|forma.?legal|entity.?type|company.?type/.test(l)) return "legal_form";
  if (/incorporat.*date|date.*incorporat|constituc/.test(l)) return "incorporation_date";
  if (/activity|activ|business|economic|\bsic\b|sector/.test(l)) return "sic_code";
  return null; // name / country / registration number = identity anchors
}
