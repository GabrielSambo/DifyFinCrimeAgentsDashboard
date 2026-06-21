import { streamChat, DifyError } from "@/lib/dify";
import { extractPayload } from "@/lib/ubo-parse";
import { normalizeKycEnvelope } from "@/lib/kyc-envelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// KYC replies stream from an LLM (first token up to ~30s); raise above Vercel's short default.
export const maxDuration = 60;

/*
  POST /api/kyc  — proxy to the live "Agente1-FIN V1" KYC onboarding agent.
  Body: { query, conversationId?, inputs?, user? }
  Returns text/event-stream:
    event: delta  data: { "text": "<token chunk>" }
    event: done   data: { "conversationId": "...", "messageId": "...", "payload": KycEnvelope | null }
    event: error  data: { "message": "...", "code": "unavailable" | "error" }

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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const user = body.user || "veritas-demo";
  const query = (body.query || "").trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      let conversationId = body.conversationId || "";
      let messageId = "";

      // Full accumulated answer (prose + the trailing ```json envelope).
      let answer = "";
      // Index of the ```json fence once seen (-1 until then); we stop streaming at it.
      let fenceAt = -1;
      // How much of the visible prose we've already streamed as `delta`.
      let sentLen = 0;

      try {
        for await (const ev of streamChat("kyc", {
          query,
          inputs: body.inputs ?? {},
          conversationId: body.conversationId,
          user,
        })) {
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
            controller.close();
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
        controller.close();
      } catch (err) {
        if (err instanceof DifyError && err.isUnavailable) {
          send("error", {
            message: "The KYC agent is not currently published in the sandbox.",
            code: "unavailable",
          });
        } else {
          send("error", {
            message: err instanceof Error ? err.message : "Unexpected error",
            code: "error",
          });
        }
        controller.close();
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
