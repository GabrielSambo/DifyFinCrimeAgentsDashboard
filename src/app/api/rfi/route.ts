export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/rfi — fire a document request (RFI) via Agent 2 (RFI Generator, Dify mode: workflow).
  Powers the Remediation "Request documents" action behind an editable email-draft approval popup.

  SAFETY (critical): Agent 2's SEND_RFI sends a real Resend email immediately — there is NO dry-run.
  So this route:
    • requires `confirm === true` in the body (the modal sets it only when the analyst clicks Confirm), and
    • has NO hardcoded app-key fallback — if DIFY_RFI_APP_KEY is unset it degrades to
      a friendly {ok:false} instead of risking a send.
  The app key never reaches the browser. `to_email` is supplied explicitly by the (editable) modal and
  defaults to a controlled inbox — never auto-pulled from client data.

  Body: { clientId, toEmail, subject, missingDocuments: string[], confirm: boolean }
  Returns: { ok: boolean, result?, reason?, note? }
*/

const BASE = process.env.DIFY_API_BASE ?? "";
const RFI_KEY = process.env.DIFY_RFI_APP_KEY;

interface Body {
  clientId?: string;
  toEmail?: string;
  subject?: string;
  missingDocuments?: string[];
  confirm?: boolean;
}

export interface RfiResult {
  ok: boolean;
  result?: string;
  reason?: string;
  note?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  if (!RFI_KEY) {
    return Response.json(
      { ok: false, note: "RFI not configured (DIFY_RFI_APP_KEY unset). Confirm the live Agent 2 key with Juan Carlos." } satisfies RfiResult,
      { status: 200 },
    );
  }
  // Belt-and-suspenders: a stray call must never dispatch an email.
  if (body.confirm !== true) {
    return Response.json({ ok: false, note: "not confirmed — no email sent" } satisfies RfiResult, { status: 200 });
  }

  const clientId = (body.clientId || "").trim();
  const toEmail = (body.toEmail || "").trim();
  if (!clientId || !toEmail) {
    return Response.json({ ok: false, note: "clientId and toEmail are required" } satisfies RfiResult, { status: 400 });
  }
  // Guard a real outbound email behind a basic address check (defense-in-depth; the UI also validates).
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) {
    return Response.json({ ok: false, note: `Invalid recipient email: "${toEmail}"` } satisfies RfiResult, { status: 400 });
  }

  try {
    // Agent 2 expects a semicolon-delimited missing_documents string.
    const missing = (body.missingDocuments || []).map((d) => d.trim()).filter(Boolean).join("; ");
    const res = await fetch(`${BASE}/workflows/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RFI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: {
          event_type: "SEND_RFI",
          case_id: clientId,
          missing_documents: missing,
          to_email: toEmail,
          from_email: "onboarding@resend.dev",
          subject_email: (body.subject || "Pending Documents").trim(),
        },
        response_mode: "blocking",
        user: "veritas-rfi",
      }),
    });
    if (!res.ok) throw new Error(`Agent 2 ${res.status}`);
    const data = (await res.json()) as { data?: { outputs?: { result?: string; reason?: string } } };
    const out = data?.data?.outputs ?? {};
    return Response.json({ ok: true, result: out.result, reason: out.reason } satisfies RfiResult);
  } catch (err) {
    return Response.json(
      { ok: false, note: err instanceof Error ? err.message : "RFI send failed" } satisfies RfiResult,
      { status: 200 },
    );
  }
}
