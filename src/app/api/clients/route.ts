import { DEMO_CLIENTS, type Client, type ClientsResponse, type RiskStatus } from "@/lib/clients";
import type { Cdd } from "@/lib/types";
import { deriveDocStatus, type Documents2Row } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET /api/clients — the client portfolio for the Dashboard / Remediation tabs.

  Server-side Supabase proxy: reads SUPABASE_URL + SUPABASE_SERVICE_KEY from env and
  never exposes the key to the browser. When those are absent it returns the built-in
  demo portfolio so the UI is always populated for the demo (source: "demo").

  The `customers` table holds the onboarded record (client_id, full_name, profile,
  data jsonb, created_at). Risk/monitoring fields are not yet persisted, so we enrich
  live rows from the demo portfolio by client_id where possible, else derive a sane
  default — this is the POC seam where a real screening-history table would plug in.
*/

const DEMO_BY_ID = new Map(DEMO_CLIENTS.map((c) => [c.client_id, c]));

interface SupabaseRow {
  client_id?: string;
  full_name?: string;
  profile?: string;
  // `data` also holds the nested `missing_documents` map + the `cdd` enrichment, so it's wider than strings.
  data?: Record<string, unknown> | null;
  created_at?: string | null;
}

/** The table stores descriptive profile strings ("Natural person", "Private company …"); normalize to PF/PJ. */
function normalizeProfile(p?: string): "PF" | "PJ" {
  return /natural\s*person|individual|\bPF\b/i.test(p || "") ? "PF" : "PJ";
}

function mapRow(row: SupabaseRow, docRows: Documents2Row[] = []): Client {
  const id = row.client_id || "—";
  const seed = DEMO_BY_ID.get(id);
  const rawData = (row.data ?? null) as Record<string, unknown> | null;
  const cdd = (rawData?.cdd as Cdd | undefined) ?? null;
  // String-ish view for the legacy KYC-field lookups below (data also holds nested objects).
  const data = rawData as (Record<string, string | null> & { cdd?: Cdd }) | null;

  // Persisted enrichment is the source of truth; fall back to the demo seed, then a default.
  const risk: RiskStatus = (cdd?.risk_status as RiskStatus) ?? seed?.risk ?? (row.data ? "review" : "pending");
  const screening_summary =
    cdd?.risk_summary ?? seed?.screening_summary ?? (data ? "Screening pending — run a remediation sweep" : "Onboarding in progress");

  return {
    client_id: id,
    full_name: row.full_name || id,
    profile: normalizeProfile(row.profile),
    data,
    cdd,
    jurisdiction:
      seed?.jurisdiction ??
      data?.["Country of Residence"] ??
      data?.["Jurisdiction"] ??
      data?.["Country"] ??
      null,
    created_at: row.created_at ?? null,
    risk,
    screening_summary,
    last_screened: cdd?.last_screened_at ?? seed?.last_screened ?? null,
    docStatus: deriveDocStatus(docRows, rawData),
  };
}

export async function GET() {
  const base = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!base || !key) {
    const body: ClientsResponse = {
      source: "demo",
      clients: DEMO_CLIENTS,
      note: "Showing the built-in demo portfolio. Add SUPABASE_URL + SUPABASE_SERVICE_KEY to .env.local to load live clients.",
    };
    return Response.json(body);
  }

  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/rest/v1/customers?select=*&order=created_at.desc`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = (await res.json()) as SupabaseRow[];

    // documents2 = the consolidated RFI status table (Agent 2 writes it). Group by client_id.
    // Never fail the whole portfolio on a documents2 hiccup — fall back to the missing-docs map.
    const byClient = new Map<string, Documents2Row[]>();
    try {
      const docRes = await fetch(`${base.replace(/\/$/, "")}/rest/v1/documents2?select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (docRes.ok) {
        const docRows = (await docRes.json()) as Documents2Row[];
        for (const r of Array.isArray(docRows) ? docRows : []) {
          const list = byClient.get(r.client_id) ?? [];
          list.push(r);
          byClient.set(r.client_id, list);
        }
      }
    } catch {
      /* documents2 unavailable → missing-map fallback handles it */
    }

    const clients = Array.isArray(rows) ? rows.map((r) => mapRow(r, byClient.get(r.client_id || "") ?? [])) : [];
    const body: ClientsResponse = { source: "live", clients };
    return Response.json(body);
  } catch (err) {
    // Never break the demo on a Supabase hiccup — fall back to the sample portfolio.
    const body: ClientsResponse = {
      source: "demo",
      clients: DEMO_CLIENTS,
      note: `Live load failed (${err instanceof Error ? err.message : "error"}); showing demo portfolio.`,
    };
    return Response.json(body);
  }
}
