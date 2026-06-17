import { streamChat, DifyError } from "@/lib/dify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// KYC replies stream from an LLM (first token up to ~30s); raise above Vercel's short default.
export const maxDuration = 60;

/*
  POST /api/kyc  — proxy to the live "Agente1-FIN V1" KYC onboarding agent.
  Body: { query, conversationId?, inputs?, user? }
  Returns text/event-stream:
    event: delta  data: { "text": "<token chunk>" }
    event: done   data: { "conversationId": "...", "messageId": "..." }
    event: error  data: { "message": "...", "code": "unavailable" | "error" }
*/

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
            send("delta", { text: ev.answer });
          } else if (ev.event === "error") {
            send("error", { message: ev.message || "Agent error", code: "error" });
            controller.close();
            return;
          }
        }
        send("done", { conversationId, messageId });
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
