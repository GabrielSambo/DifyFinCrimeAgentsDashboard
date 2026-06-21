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
  type: "text" | "date";
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

  const out: Record<string, FieldSuggestion> = {};
  for (const f of fields) {
    const l = `${f.key} ${f.label}`.toLowerCase();

    // Never auto-fill judgments / unsourced facts.
    if (/regulat|listing|listed|source.?of.?funds|source.?of.?wealth|\bwealth\b|\bfunds?\b/.test(l)) continue;

    let value: string | undefined;
    if (/address|registered.?office|domicil/.test(l)) value = t.registered_address ?? undefined;
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
