import type { Cdd, CddHistoryEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET   /api/clients/[id]  → the single client record (incl. data.cdd enrichment).
  PATCH /api/clients/[id]  → merge enrichment into customers.data.cdd.

  Persistence seam for the client-centric loop (Q3). Enrichment is stored in a
  namespaced `data.cdd` jsonb object so no schema change is needed. PostgREST PATCH
  replaces the whole `data` column, so we read-modify-write: GET current data, deep-merge
  cdd, PATCH the full data. Service key is server-only; never exposed to the browser.
*/

const URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY;
const HISTORY_CAP = 20;

function headers() {
  return { apikey: KEY!, Authorization: `Bearer ${KEY!}`, "Content-Type": "application/json" };
}

async function fetchRow(id: string): Promise<{ data?: Record<string, unknown> } | null> {
  const res = await fetch(`${URL}/rest/v1/customers?client_id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as Array<{ data?: Record<string, unknown> }>;
  return rows[0] ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!URL || !KEY) return Response.json({ ok: false, note: "Supabase not configured" }, { status: 200 });
  try {
    const row = await fetchRow(id);
    if (!row) return Response.json({ ok: false, note: "not found" }, { status: 404 });
    return Response.json({ ok: true, client: row });
  } catch (err) {
    return Response.json({ ok: false, note: err instanceof Error ? err.message : "error" }, { status: 200 });
  }
}

interface PatchBody {
  cddPatch?: Partial<Cdd>;
  appendHistory?: CddHistoryEntry;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;

  if (!URL || !KEY) {
    return Response.json({ ok: false, note: "Supabase not configured — persistence skipped (demo mode)" }, { status: 200 });
  }

  try {
    const row = await fetchRow(id);
    if (!row) return Response.json({ ok: false, note: "client not found" }, { status: 404 });

    const data = (row.data ?? {}) as Record<string, unknown>;
    const prevCdd = (data.cdd ?? { history: [] }) as Cdd;

    const mergedCdd: Cdd = {
      ...prevCdd,
      ...body.cddPatch,
      history: prevCdd.history ?? [],
    };
    if (body.appendHistory) {
      mergedCdd.history = [body.appendHistory, ...(prevCdd.history ?? [])].slice(0, HISTORY_CAP);
    }

    const nextData = { ...data, cdd: mergedCdd };

    const res = await fetch(`${URL}/rest/v1/customers?client_id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({ data: nextData }),
    });
    if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${await res.text().catch(() => "")}`);

    return Response.json({ ok: true, cdd: mergedCdd });
  } catch (err) {
    return Response.json({ ok: false, note: err instanceof Error ? err.message : "patch failed" }, { status: 200 });
  }
}
