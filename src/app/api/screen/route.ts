export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// PEP/sanctions screening calls the agent backend; raise above Vercel's short default.
export const maxDuration = 60;

/*
  POST /api/screen — screen one or more names against the standalone PEP Screening App
  (Q2 Phase C). Powers the Remediation "re-screen" action and the client-profile
  screening card. Server-side only; the PEP app key never reaches the browser.

  Body: { name: string, entityType?: "Person" | "Organization", jurisdiction?: string }
  Returns the PEP app's structured result: { results, summary, highlight, source }.
*/

const BASE = process.env.DIFY_API_BASE ?? "";
const PEP_KEY = process.env.DIFY_PEP_APP_KEY ?? "";

interface Body {
  name?: string;
  entityType?: "Person" | "Organization";
  jurisdiction?: string;
}

export interface ScreenResult {
  source: "live" | "error";
  summary?: {
    screened: number;
    matches: number;
    pep_hits: number;
    sanctions_hits: number;
    debarment_hits: number;
    errors: number;
    highest_risk?: string;
  };
  results?: Array<Record<string, unknown>>;
  highlight?: string;
  message?: string;
}

function parseAnswer(answer: string): { results?: unknown[]; summary?: unknown; highlight?: string } {
  const m = answer.match(/```json\s*([\s\S]*?)```/i);
  let parsed: { results?: unknown[]; summary?: unknown } = {};
  if (m) {
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      /* fall through */
    }
  }
  const highlight = m ? answer.slice((m.index ?? 0) + m[0].length).trim() : answer.trim();
  return { results: parsed.results, summary: parsed.summary, highlight };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const name = (body.name || "").trim();
  if (!name) {
    return Response.json({ source: "error", message: "name is required" } satisfies ScreenResult, { status: 400 });
  }

  try {
    const res = await fetch(`${BASE}/chat-messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PEP_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: {
          names: name,
          entity_type: body.entityType || "Person",
          jurisdiction: body.jurisdiction || "",
        },
        query: "screen",
        response_mode: "blocking",
        user: "veritas-remediation",
      }),
    });
    if (!res.ok) throw new Error(`PEP app ${res.status}`);
    const data = (await res.json()) as { answer?: string };
    const { results, summary, highlight } = parseAnswer(data.answer || "");
    return Response.json({
      source: "live",
      results: results as ScreenResult["results"],
      summary: summary as ScreenResult["summary"],
      highlight,
    } satisfies ScreenResult);
  } catch (err) {
    return Response.json(
      { source: "error", message: err instanceof Error ? err.message : "screen failed" } satisfies ScreenResult,
      { status: 200 },
    );
  }
}
