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
  // Agent 2 upserts on_conflict=(client_id,document_code), so updated_at moves when a doc's state changes.
  // This is the anchor for the 180-day expiry rule (a validated doc untouched for >180d is "stale").
  updated_at?: string | null;
}

export type LightState = "green" | "amber" | "red" | "unknown";

export interface DocItem {
  code: string;
  label: string;
  requested: boolean;
  received: boolean;
  validated: boolean;
  url?: string | null;
  /** When this doc was last touched (documents2.updated_at) — drives the expiry tooltip. */
  validatedAt?: string | null;
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

/*
  Document-expiry remediation rule (the ONE rule agreed in the 2026-06-06 daily): a fully-validated client
  whose documents have gone stale should NOT show an all-clear green light. When the newest validated
  document was last touched more than EXPIRY_DAYS ago, the Validated light is downgraded green → amber.
  Pure front-end/DB math (no agent). UTC-day math mirrors lib/review.ts to stay hydration-safe.
*/
export const EXPIRY_DAYS = 180;
const DAY_MS = 86_400_000;

/** UTC midnight epoch for a date — so server and client agree (no hydration drift). */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days between an ISO date and today (UTC). null/invalid → null. */
function ageDays(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((utcDay(new Date()) - utcDay(d)) / DAY_MS);
}

/** True when a validated doc has gone stale (last touched > EXPIRY_DAYS ago). */
export function isExpired(validatedAt?: string | null): boolean {
  const age = ageDays(validatedAt);
  return age !== null && age > EXPIRY_DAYS;
}

/** Per-document expiry detail (only meaningful for validated docs that carry a date). */
export interface DocExpiry {
  code: string;
  label: string;
  validatedAt: string;     // ISO — when the doc reached validated state (documents2.updated_at)
  ageDays: number;         // whole days since validated
  expiresOn: string;       // ISO — validatedAt + EXPIRY_DAYS
  daysLeft: number;        // EXPIRY_DAYS - ageDays (negative ⇒ already expired by |daysLeft|)
  expired: boolean;        // ageDays > EXPIRY_DAYS
}

export interface ExpirySummary {
  /** True when we have validated docs with real dates to reason about. */
  tracked: boolean;
  /** Documents past the EXPIRY_DAYS window (need re-collection). */
  expired: DocExpiry[];
  /** All validated-with-date documents, soonest-to-expire first. */
  items: DocExpiry[];
  /** The next document to expire (or the most-overdue when all are expired). */
  next: DocExpiry | null;
  /** tracked && nothing expired — the healthy "we're good" state. */
  allCurrent: boolean;
}

/**
 * Compute document-expiry status for a client's docs. Pure front-end/DB math (the 2026-06-06 daily's
 * single agreed rule): a validated document older than EXPIRY_DAYS is "expired" and must be re-requested.
 * Renders meaningfully whether or not anything is expired — green when all current, amber when stale.
 */
export function docExpiry(items: DocItem[]): ExpirySummary {
  const tracked: DocExpiry[] = items
    .filter((i) => i.validated && i.validatedAt)
    .map((i) => {
      const validatedAt = i.validatedAt as string;
      const age = ageDays(validatedAt) ?? 0;
      const expiresMs = utcDay(new Date(validatedAt)) + EXPIRY_DAYS * DAY_MS;
      return {
        code: i.code,
        label: i.label,
        validatedAt,
        ageDays: age,
        expiresOn: new Date(expiresMs).toISOString(),
        daysLeft: EXPIRY_DAYS - age,
        expired: age > EXPIRY_DAYS,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft); // soonest-to-expire (or most overdue) first

  const expired = tracked.filter((d) => d.expired);
  return {
    tracked: tracked.length > 0,
    expired,
    items: tracked,
    next: tracked[0] ?? null,
    allCurrent: tracked.length > 0 && expired.length === 0,
  };
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
      validatedAt: r.updated_at ?? null,
    }));
    const total = items.length;
    const nReq = items.filter((i) => i.requested).length;
    const nRecv = items.filter((i) => i.received).length;
    const nVal = items.filter((i) => i.validated).length;

    // Expiry rule: an otherwise-green Validated light goes amber when the freshest validated doc is stale.
    let validatedLight = light(nVal, total);
    const validatedDates = items.filter((i) => i.validated && i.validatedAt).map((i) => i.validatedAt as string);
    const newestValidatedAt = validatedDates.sort().at(-1) ?? null; // ISO sorts lexically = chronologically
    const expired = validatedLight === "green" && isExpired(newestValidatedAt);
    if (expired) validatedLight = "amber";

    // Outstanding = not-yet-validated OR validated-but-expired (the latter need re-collection/remediation).
    const outstanding = items
      .filter((i) => !i.validated || (expired && i.validated && isExpired(i.validatedAt)))
      .map((i) => i.label);

    return {
      source: "documents2",
      items,
      outstanding,
      total,
      requestedLight: light(nReq, total),
      receivedLight: light(nRecv, total),
      validatedLight,
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
