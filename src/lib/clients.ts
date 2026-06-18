/*
  Client portfolio types + demo data for the Veritas Dashboard / Remediation tabs.

  A "client" is the first-class object the whole app revolves around: it is onboarded
  (KYC), screened (PEP/sanctions — Phase C), and ownership-traced (UBO). The Supabase
  `customers` table holds the onboarded record (client_id, full_name, profile, data);
  risk + monitoring fields below are derived/POC for the demo and degrade gracefully
  until persisted server-side.
*/

import type { Cdd } from "@/lib/types";
import type { DocStatus } from "@/lib/documents";

export type RiskStatus = "alert" | "review" | "cleared" | "pending";
export type ClientKind = "PF" | "PJ";
/** Lifecycle axis: "new" = mid-onboarding (Onboarding view); "existing" = already a client (Remediation view). */
export type ClientType = "existing" | "new";

export interface Client {
  client_id: string;
  full_name: string;
  /** "PF" (natural person) | "PJ" (legal entity) — from onboarding. */
  profile: ClientKind | string;
  /**
   * "new" (being onboarded) vs "existing" (already a client → can be remediated). Derived in /api/clients
   * from an explicit `client_type` column → `data.client_type` jsonb → onboarding state (risk/data) fallback.
   */
  client_type: ClientType;
  /** Free-form KYC template fields captured at onboarding (Supabase `data` jsonb). */
  data?: Record<string, string | null> | null;
  jurisdiction?: string | null;
  created_at?: string | null;
  /** Derived risk posture for the portfolio view. */
  risk: RiskStatus;
  /** Short human label for the latest screening outcome. */
  screening_summary?: string;
  /** ISO date of the last PEP/sanctions screen — drives the Remediation cadence. */
  last_screened?: string | null;
  /** Days until the next periodic review is due (negative ⇒ overdue). */
  review_due_in_days?: number;
  /** Persisted enrichment (customers.data.cdd) — screening + ownership + history. */
  cdd?: Cdd | null;
  /** Document-request lifecycle status (documents2 + missing-docs fallback). Attached by /api/clients. */
  docStatus?: DocStatus | null;
}

export interface ClientsResponse {
  /** "live" when backed by Supabase, "demo" when using the built-in sample portfolio. */
  source: "live" | "demo";
  clients: Client[];
  note?: string;
}

export const RISK_META: Record<RiskStatus, { label: string; tone: "good" | "warn" | "bad" | "default"; dot: string }> = {
  alert: { label: "PEP / Sanctions alert", tone: "bad", dot: "bg-bad" },
  review: { label: "Needs review", tone: "warn", dot: "bg-warn" },
  cleared: { label: "Cleared", tone: "good", dot: "bg-good" },
  pending: { label: "Onboarding", tone: "default", dot: "bg-ink-3" },
};

/*
  Demo portfolio. Includes the two clients actually created against the live sandbox
  during Phase C testing (PEPTEST-001 → Putin → alert; CLEANTEST-002 → cleared), plus
  representative company clients so the ownership/remediation views tell a full story.
*/
export const DEMO_CLIENTS: Client[] = [
  {
    client_id: "PEPTEST-001",
    full_name: "Vladimir Putin",
    profile: "PF",
    client_type: "existing",
    jurisdiction: "Russia",
    created_at: "2026-06-16",
    risk: "alert",
    screening_summary: "PEP · Sanctioned · Debarred (score 1.0)",
    last_screened: "2026-06-16",
    review_due_in_days: -2,
    data: { Nationality: "Russian", "Country of Residence": "Russia", "Economic Activity": "Government" },
  },
  {
    client_id: "ALDI-UK-014",
    full_name: "ALDI STORES LIMITED",
    profile: "PJ",
    client_type: "existing",
    jurisdiction: "United Kingdom",
    created_at: "2026-05-29",
    risk: "review",
    screening_summary: "8 parties screened · 0 hits · UBO: Albrecht family",
    last_screened: "2026-05-29",
    review_due_in_days: 12,
    data: { "Company number": "00510496", "Economic Activity": "Retail — non-specialised stores" },
  },
  {
    client_id: "BREWDOG-007",
    full_name: "BREWDOG PLC",
    profile: "PJ",
    client_type: "existing",
    jurisdiction: "United Kingdom",
    created_at: "2026-05-21",
    risk: "review",
    screening_summary: "Turnover ≈£549.78M — above £36M MSA threshold",
    last_screened: "2026-04-30",
    review_due_in_days: -5,
    data: { "Company number": "SC554909", "Economic Activity": "Manufacture of beer" },
    docStatus: {
      source: "missing_map",
      items: [],
      outstanding: ["Latest Financial Statements - FS", "Proof of residence of the UBO(s)"],
      total: 8,
      requestedLight: "unknown",
      receivedLight: "unknown",
      validatedLight: "red",
    },
  },
  {
    client_id: "CLEANTEST-002",
    full_name: "Margaret Wellington Brightwater",
    profile: "PF",
    client_type: "existing",
    jurisdiction: "United Kingdom",
    created_at: "2026-06-16",
    risk: "cleared",
    screening_summary: "No screening hits",
    last_screened: "2026-06-16",
    review_due_in_days: 360,
    data: { Nationality: "British", "Economic Activity": "Bakery owner" },
  },
  {
    client_id: "ACME-001",
    full_name: "Acme Trading Ltd",
    profile: "PJ",
    client_type: "existing",
    jurisdiction: "Ireland",
    created_at: "2026-06-15",
    risk: "cleared",
    screening_summary: "No screening hits · food wholesaler",
    last_screened: "2026-06-15",
    review_due_in_days: 358,
    data: { Incorporated: "2015", "Economic Activity": "Food wholesale" },
    docStatus: {
      source: "documents2",
      items: [
        { code: "proof_of_identity", label: "Proof of identity", requested: true, received: true, validated: true },
        { code: "proof_of_taxes", label: "Proof of taxes", requested: true, received: true, validated: true },
      ],
      outstanding: [],
      total: 2,
      requestedLight: "green",
      receivedLight: "green",
      validatedLight: "green",
    },
  },
  {
    client_id: "PESCA-UK-031",
    full_name: "PESCA UK LIMITED",
    profile: "PJ",
    client_type: "new",
    jurisdiction: "United Kingdom",
    created_at: "2026-06-02",
    risk: "pending",
    screening_summary: "Onboarding — screening not yet run",
    last_screened: null,
    review_due_in_days: 0,
    data: { "Economic Activity": "Seafood import" },
  },
];

export function riskRank(r: RiskStatus): number {
  return { alert: 0, review: 1, pending: 2, cleared: 3 }[r];
}
