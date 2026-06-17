/*
  Types for the UBO agent's kyc_lite JSON payload.
  Derived from a live ALDI STORES LIMITED run (2026-06-11) — every field here
  was observed on the wire. Most are optional because the agent omits fields it
  cannot resolve; the UI must degrade gracefully.
*/

export type Confidence = "high" | "medium" | "low";
export type ScreeningStatus = "no_match" | "match" | "candidate" | "error" | "skipped";

export interface PreviousName {
  name: string;
  from: string | null;
  to: string | null;
  within_5y: boolean;
}

export interface Screening {
  status: ScreeningStatus;
}

export interface UboTarget {
  name: string;
  jurisdiction?: string;
  lei?: string | null;
  company_number?: string | null;
  legal_form?: string | null;
  incorporation_date?: string | null;
  registered_address?: string | null;
  economic_activity?: string | null;
  sic_codes?: string[];
  previous_names?: PreviousName[];
  screening?: Screening;
}

export interface Ubo {
  name: string;
  type: "natural" | "legal" | string;
  ownership_pct?: number | null;
  ownership_basis?: string | null;
  role?: string | null;
  jurisdiction?: string | null;
  source_type?: string | null;
  confidence?: Confidence | null;
  source_urls?: string[];
  lei?: string | null;
  company_number?: string | null;
  screening?: Screening;
}

export interface Shareholder {
  name?: string;
  pct_band?: string | null;
  [k: string]: unknown;
}

export interface ChainNode {
  entity: string;
  lei?: string | null;
  company_number?: string | null;
  jurisdiction?: string | null;
  pct_band?: string | null;
  pct_estimate?: number | null;
  pct_method?: string | null;
  pct_confidence?: Confidence | null;
  previous_names?: PreviousName[];
  shareholders?: Shareholder[];
  screening?: Screening;
}

export interface AdverseMediaItem {
  title?: string;
  url?: string;
  summary?: string;
  date?: string;
  severity?: string;
  [k: string]: unknown;
}

export interface UltimateParent {
  name: string;
  type?: string;
  jurisdiction?: string | null;
  company_number?: string | null;
  lei?: string | null;
  basis?: string | null;
}

export interface ModernSlaveryStatement {
  entity: string;
  company_number?: string;
  year?: string;
  url?: string;
}

export interface ModernSlavery {
  in_scope: boolean;
  target_covered?: boolean;
  covered_by?: string | null;
  compliance_gap?: boolean;
  statements?: ModernSlaveryStatement[];
}

export interface Turnover {
  value?: number | null;
  /** Raw kyc_lite field — normalized into `value` by lib/ubo-normalize. */
  value_gbp?: number | null;
  currency?: string | null;
  method?: string | null;
  confidence?: Confidence | null;
  /** Normalized to boolean|null; raw kyc_lite emits "yes"|"no"|"unknown". */
  exceeds_36m?: boolean | "yes" | "no" | "unknown" | null;
  basis?: string | null;
}

/* ---------- Persisted client due-diligence (customers.data.cdd) ---------- */

export interface ScreenSummary {
  screened?: number;
  matches?: number;
  candidates?: number;
  pep_hits?: number;
  sanctions_hits?: number;
  debarment_hits?: number;
  errors?: number;
  highest_risk?: string;
}

export interface CddHistoryEntry {
  at: string;
  kind: "screen" | "ubo";
  risk_status: string;
  note: string;
}

/** Namespaced enrichment persisted under customers.data.cdd (no schema change). */
export interface Cdd {
  risk_status: "alert" | "review" | "cleared" | "pending";
  risk_summary: string;
  last_screened_at: string | null;
  /** Analyst-set review cadence in days. Next-review date is derived = last screened + this. Optional. */
  review_cadence_days?: number | null;
  screening?: { summary: ScreenSummary; results?: Array<Record<string, unknown>> };
  ubo?: UboPayload;
  ubo_resolved_name?: string;
  history: CddHistoryEntry[];
}

/** The canonical machine-readable payload the agent writes to conversation.ubo_json. */
export interface UboPayload {
  target: UboTarget;
  ubos: Ubo[];
  ownership_chain?: ChainNode[];
  adverse_media?: AdverseMediaItem[];
  information_gaps?: string[];
  summary?: string;
  iterations_used?: number;
  coverage_note?: string;
  ultimate_parent?: UltimateParent | null;
  modern_slavery?: ModernSlavery | null;
  turnover?: Turnover | null;
}

/** Full-mode report types live in ./ubo-report; re-exported here for one import surface. */
export type {
  UboReportHeader,
  UboReportResult,
  ScreeningCounts,
  TocEntry,
} from "./ubo-report";

/** Entity-disambiguation candidate (./ubo-disambig). */
export type { DisambigCandidate } from "./ubo-disambig";

/** A disambiguation candidate returned when canonical_name_input is empty. */
export interface Candidate {
  index: number;
  raw: string;
}

/** Normalized result of one UBO run, ready for the UI. */
export interface UboRunResult {
  conversationId: string;
  messageId: string;
  /** Parsed JSON payload, if the answer contained a valid ```json block. */
  payload: UboPayload | null;
  /** The human-readable markdown above the JSON (screening summary etc.). */
  narrative: string;
  /** Progress lines like "Ownership search 1 of 3 completed". */
  progress: string[];
  /** True when the agent is asking the user to pick among candidates. */
  awaitingDisambiguation: boolean;
  candidates: Candidate[];
  /** Raw answer, kept for debugging / "view source". */
  rawAnswer: string;
  parseError?: string;
}
