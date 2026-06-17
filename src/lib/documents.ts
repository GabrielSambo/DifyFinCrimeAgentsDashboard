/*
  Document-lifecycle status for the Veritas Dashboard / Remediation surfaces.

  Two real data sources (verified live 2026-06-17 — see memory supabase-document-tables-reality):
    1. `documents2` — the consolidated status-driven table Agent 2 (RFI) writes. Per-doc lifecycle
       booleans: requested / received_raw / validated. This is the CANONICAL source for the 3 lights.
    2. `customers.data.missing_documents` (or the space-spelled `"missing documents"`) — a per-doc map
       { label: 0 | 1 } where 1 = still outstanding. Broad coverage fallback when a client has no
       documents2 rows yet.

  Pure module — imported by the /api/clients route (server) AND client components (composeRfiDraft).
  No "use client", no "server-only".
*/

export interface Documents2Row {
  client_id: string;
  document_code: string;
  document_label: string;
  document_name?: string | null;
  document_url?: string | null;
  requested: boolean;
  received_raw: boolean;
  validated: boolean;
}

export type LightState = "green" | "amber" | "red" | "unknown";

export interface DocItem {
  code: string;
  label: string;
  requested: boolean;
  received: boolean;
  validated: boolean;
  url?: string | null;
}

export interface DocStatus {
  /** Where the status came from — drives how honest the lights can be. */
  source: "documents2" | "missing_map" | "none";
  /** Per-document lifecycle rows (only populated from documents2). */
  items: DocItem[];
  /** Labels of documents still missing / not validated. */
  outstanding: string[];
  /** Total documents tracked (documents2 rows, or missing-map entries). */
  total: number;
  requestedLight: LightState;
  receivedLight: LightState;
  validatedLight: LightState;
}

/** customers.profile is prose; map to kyc_typologies.typology_code (covers all current clients). */
export const PROFILE_TO_TYPOLOGY: Record<string, string> = {
  "Private company (e.g., S.A., S.á. r.l., S.E.)": "private_company",
  "Private company": "private_company",
  "Bank, FI, Insurance company": "bank_fi_insurance",
  "Natural person": "natural_person",
};

/** Return the missing-docs map regardless of which key spelling the row uses, or null. */
function getMissingMap(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const m = (data["missing_documents"] ?? data["missing documents"]) as unknown;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
}

/** Labels still outstanding (value == 1) from the missing-docs map. */
export function parseMissingDocs(data: Record<string, unknown> | null | undefined): string[] {
  const map = getMissingMap(data);
  if (!map) return [];
  return Object.entries(map)
    .filter(([, v]) => Number(v) === 1)
    .map(([label]) => label);
}

function light(n: number, total: number): LightState {
  if (total === 0) return "unknown";
  if (n >= total) return "green";
  return n > 0 ? "amber" : "red";
}

/**
 * Derive the 3-light document status for one client.
 * documents2 rows win; otherwise fall back to the missing-docs map (coarser — only validated is knowable).
 */
export function deriveDocStatus(
  rows: Documents2Row[],
  data: Record<string, unknown> | null | undefined,
): DocStatus {
  if (rows.length > 0) {
    const items: DocItem[] = rows.map((r) => ({
      code: r.document_code,
      label: r.document_label,
      requested: !!r.requested,
      received: !!r.received_raw,
      validated: !!r.validated,
      url: r.document_url ?? null,
    }));
    const total = items.length;
    const nReq = items.filter((i) => i.requested).length;
    const nRecv = items.filter((i) => i.received).length;
    const nVal = items.filter((i) => i.validated).length;
    return {
      source: "documents2",
      items,
      outstanding: items.filter((i) => !i.validated).map((i) => i.label),
      total,
      requestedLight: light(nReq, total),
      receivedLight: light(nRecv, total),
      validatedLight: light(nVal, total),
    };
  }

  const map = getMissingMap(data);
  if (map) {
    const outstanding = parseMissingDocs(data);
    const total = Object.keys(map).length;
    return {
      source: "missing_map",
      items: [],
      outstanding,
      total,
      // No request/receive granularity in the missing-map — only completeness is knowable.
      requestedLight: "unknown",
      receivedLight: "unknown",
      validatedLight: outstanding.length === 0 ? "green" : "red",
    };
  }

  return {
    source: "none",
    items: [],
    outstanding: [],
    total: 0,
    requestedLight: "unknown",
    receivedLight: "unknown",
    validatedLight: "unknown",
  };
}

/** Compose a default, editable RFI draft email from the outstanding-docs list (pure; no network). */
export function composeRfiDraft(
  clientName: string,
  outstanding: string[],
): { subject: string; body: string } {
  const subject = `Pending documents — ${clientName}`;
  const list = outstanding.length
    ? outstanding.map((d) => `  • ${d}`).join("\n")
    : "  • (no outstanding documents on file)";
  const body =
    `Dear ${clientName},\n\n` +
    `As part of our ongoing due-diligence review, we still require the following document(s):\n\n` +
    `${list}\n\n` +
    `Please reply to this email with the requested document(s) at your earliest convenience.\n\n` +
    `Kind regards,\nCompliance Team`;
  return { subject, body };
}
