import { streamChat, DifyError } from "@/lib/dify";
import { extractPayload } from "@/lib/ubo-parse";
import { normalizeKycEnvelope } from "@/lib/kyc-envelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// KYC replies stream from an LLM (first token up to ~30s); raise above Vercel's short default.
// NOTE: this is Vercel's TOTAL function cap — keepalive does NOT extend it. A turn needing more
// than this dies as a raw 504 on the initial fetch (handled client-side). Bump toward the plan max
// (e.g. 300 on Pro) for headroom; on Hobby it's clamped. See PRPs/ai_docs/sse-keepalive-and-timeouts.md.
export const maxDuration = 60;

// Heartbeat cadence (downstream): ping the client so an intermediary never drops an idle SSE
// connection while the agent blocks silently on its UBO/screening sub-calls.
const KEEPALIVE_MS = 15_000;
// Idle timeout (upstream): abort the Dify fetch only after this much silence from Dify. This is an
// IDLE timer (reset on every upstream event) NOT a total timeout, so a slow-but-alive stream is
// never cut — only a genuine hang. The abort surfaces as a friendly `code: "timeout"`.
const UPSTREAM_IDLE_MS = 45_000;

/*
  POST /api/kyc  — proxy to the live "Agente1-FIN V1" KYC onboarding agent.
  Body: { query, conversationId?, inputs?, user? }
  Returns text/event-stream:
    event: delta  data: { "text": "<token chunk>" }
    event: done   data: { "conversationId": "...", "messageId": "...", "payload": KycEnvelope | null }
    event: error  data: { "message": "...", "code": KycErrorCode }
      code ∈ "timeout" | "rate_limit" | "unavailable" | "server" | "error"  (see lib/kycErrors.ts)
    : ping        keepalive comment (no event/data) — the client's parseSse ignores it

  Migrated onboarding answers append one ```json envelope after their prose. We accumulate the
  full answer, stream only the prose BEFORE the fence (the raw JSON must never flash in the bubble),
  then emit the parsed+normalized envelope on `done`. Un-migrated answers carry no fence → payload
  is null and the streamed prose stands unchanged (no regression).
*/

// Hold back this many trailing chars while streaming so an opening "```json" fence that arrives
// split across SSE chunks is never partially emitted as visible text. (len("```json") - 1)
const FENCE_LOOKBACK = 6;

interface Body {
  query?: string;
  conversationId?: string;
  inputs?: Record<string, unknown>;
  user?: string;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Map a thrown upstream failure (or our own idle-abort) to a stable client-facing code.
// Mirrors lib/kycErrors.ts + PRPs/ai_docs/sse-keepalive-and-timeouts.md.
function codeFor(err: unknown, aborted: boolean): { code: string; message: string } {
  if (aborted || (err instanceof Error && err.name === "AbortError")) {
    return { code: "timeout", message: "The KYC agent took too long to respond." };
  }
  if (err instanceof DifyError) {
    if (err.isUnavailable)
      return { code: "unavailable", message: "The KYC agent is not currently published in the sandbox." };
    if (err.status === 504 || err.status === 502 || err.status === 408)
      return { code: "timeout", message: err.message };
    if (err.status === 429) return { code: "rate_limit", message: err.message };
    if (err.status >= 500) return { code: "server", message: err.message };
  }
  return { code: "error", message: err instanceof Error ? err.message : "Unexpected error" };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const user = body.user || "veritas-demo";
  const query = (body.query || "").trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Guard: enqueue() after close() throws. `closed` short-circuits the keepalive interval,
      // and every enqueue is wrapped so a race at close can't crash the stream.
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          /* controller already closed mid-flight */
        }
      };
      const send = (event: string, data: unknown) =>
        safeEnqueue(encoder.encode(sse(event, data)));
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      // Downstream keepalive: ping the client on an independent interval so an idle SSE
      // connection is never dropped while Dify blocks silently on its sub-calls.
      const ping = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), KEEPALIVE_MS);

      // Upstream idle timeout: abort the Dify fetch only after UPSTREAM_IDLE_MS of silence.
      const ctrl = new AbortController();
      let idle: ReturnType<typeof setTimeout> | undefined;
      const resetIdle = () => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), UPSTREAM_IDLE_MS);
      };

      let conversationId = body.conversationId || "";
      let messageId = "";

      // Full accumulated answer (prose + the trailing ```json envelope).
      let answer = "";
      // Index of the ```json fence once seen (-1 until then); we stop streaming at it.
      let fenceAt = -1;
      // How much of the visible prose we've already streamed as `delta`.
      let sentLen = 0;

      try {
        resetIdle();
        for await (const ev of streamChat("kyc", {
          query,
          inputs: body.inputs ?? {},
          conversationId: body.conversationId,
          user,
          signal: ctrl.signal,
        })) {
          resetIdle(); // every upstream event (incl. Dify pings/node events) keeps us alive

          if (ev.conversation_id) conversationId = ev.conversation_id;
          if (ev.message_id || ev.id) messageId = ev.message_id || ev.id || messageId;

          if (ev.event === "message" && typeof ev.answer === "string") {
            answer += ev.answer;
            if (fenceAt === -1) {
              const i = answer.indexOf("```json");
              if (i === -1) {
                // No fence yet — stream prose but hold back a small tail in case the
                // fence opener is split across the next chunk.
                const safe = answer.length - FENCE_LOOKBACK;
                if (safe > sentLen) {
                  send("delta", { text: answer.slice(sentLen, safe) });
                  sentLen = safe;
                }
              } else {
                // Fence found — emit the remaining prose up to it, then suppress the rest.
                fenceAt = i;
                if (i > sentLen) send("delta", { text: answer.slice(sentLen, i) });
                sentLen = i;
              }
            }
            // Once fenceAt is set, the JSON envelope is suppressed from the visible stream.
          } else if (ev.event === "error") {
            send("error", { message: ev.message || "Agent error", code: "error" });
            close();
            return;
          }
        }

        // No fence at all → flush the held-back tail so un-migrated prose is complete.
        if (fenceAt === -1 && answer.length > sentLen) {
          send("delta", { text: answer.slice(sentLen) });
        }

        const { payload } = extractPayload(answer);
        send("done", {
          conversationId,
          messageId,
          payload: normalizeKycEnvelope(payload),
        });
        close();
      } catch (err) {
        const { code, message } = codeFor(err, ctrl.signal.aborted);
        send("error", { message, code });
        close();
      } finally {
        clearInterval(ping);
        if (idle) clearTimeout(idle);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
