export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Attribute lookup hits the agent backend (registry or SERP); raise above Vercel's short default.
export const maxDuration = 60;

/*
  POST /api/attribute — resolve ONE company attribute for an already-resolved entity, via the
  standalone Attribute-Lookup app (registry-first, Google-SERP+LLM web fallback). Powers the
  per-field "re-search" (🔍) in the KYC onboarding template. Server-side only; the app key never
  reaches the browser. Mirrors /api/screen (blocking Dify call + ```json parse).

  Body: { company_name, jurisdiction?, company_number?, attribute }
  Returns: { source, value?, source_url?, confidence?, method? }
*/

const BASE = process.env.DIFY_API_BASE?.trim() ?? "";
const ATTR_KEY = process.env.DIFY_ATTRIBUTE_APP_KEY?.trim() ?? "";

interface Body {
  company_name?: string;
  jurisdiction?: string;
  company_number?: string;
  lei?: string;
  attribute?: string;
}

export interface AttributeResult {
  source: "live" | "error";
  value?: string;
  source_url?: string;
  confidence?: "high" | "medium" | "low";
  method?: "registry" | "web";
  message?: string;
}

function parseAnswer(answer: string): Partial<AttributeResult> {
  const m = answer.match(/```json\s*([\s\S]*?)```/i);
  if (m) {
    try {
      const p = JSON.parse(m[1].trim()) as Partial<AttributeResult>;
      return { value: p.value, source_url: p.source_url, confidence: p.confidence, method: p.method };
    } catch {
      /* fall through to empty */
    }
  }
  return {};
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const company_name = (body.company_name || "").trim();
  const attribute = (body.attribute || "").trim();
  if (!company_name || !attribute) {
    return Response.json(
      { source: "error", message: "company_name and attribute are required" } satisfies AttributeResult,
      { status: 400 },
    );
  }
  if (!ATTR_KEY) {
    return Response.json(
      { source: "error", message: "Attribute-Lookup app not configured (DIFY_ATTRIBUTE_APP_KEY)." } satisfies AttributeResult,
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`${BASE}/chat-messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ATTR_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: {
          company_name,
          jurisdiction: body.jurisdiction || "",
          company_number: body.company_number || "",
          lei: body.lei || "",
          attribute,
        },
        query: "lookup",
        response_mode: "blocking",
        user: "veritas-attribute",
      }),
    });
    if (!res.ok) throw new Error(`Attribute app ${res.status}`);
    const data = (await res.json()) as { answer?: string };
    const parsed = parseAnswer(data.answer || "");
    return Response.json({ source: "live", ...parsed } satisfies AttributeResult);
  } catch (err) {
    return Response.json(
      { source: "error", message: err instanceof Error ? err.message : "attribute lookup failed" } satisfies AttributeResult,
      { status: 200 },
    );
  }
}
