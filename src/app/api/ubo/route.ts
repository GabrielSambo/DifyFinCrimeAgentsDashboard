import { streamChat, DifyError } from "@/lib/dify";
import { extractProgress, extractPayload } from "@/lib/ubo-parse";
import { stripProgress, extractReportHeader } from "@/lib/ubo-report";
import { isDisambiguation, parseCandidates } from "@/lib/ubo-disambig";
import { normalizeUboPayload } from "@/lib/ubo-normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Full UBO investigations routinely run 60s–3min (measured: a depth-2 ownership-only run is ~62s;
// depth-3 with adverse-media + screening is longer). Raise the serverless cap accordingly.
// NOTE: this is clamped by the hosting plan — Vercel Hobby hard-caps at 60s (long runs CANNOT
// complete there), Pro allows 300s. On a non-serverless host (Render/Railway/VM) it's ignored.
export const maxDuration = 300;

/*
  POST /api/ubo
  Body: { company, jurisdiction, depth?, mode?, canonicalName?, conversationId?, query?, user }
  Defaults to mode=full — the analyst-facing 9-section markdown report (with the
  Mermaid ownership diagram + Sources). kyc_lite is the KYC agent's machine path
  and is not served here. Returns text/event-stream with our own clean events:
    event: progress    data: { "text": "Ownership search 1 of 3 completed" }
    event: candidates  data: { conversationId, candidates }  (turn 1, awaiting entity choice)
    event: done        data: <UboReportResult>  ({ conversationId, messageId, markdown, header })
    event: error       data: { "message": "...", "code": "unavailable" | "error" }

  Turn 1 (resolve): send { company, jurisdiction, depth, mode } with NO canonicalName
  and no conversationId → the agent replies with a candidate list (`candidates`).
  Turn 2 (investigate): send { jurisdiction, depth, mode, conversationId, query: "<n>" }
  on the same conversation → the full report (`done`). A non-empty `canonicalName`
  still takes the pre-resolved fast path (skips disambiguation) for API callers.
*/

interface Body {
  company?: string;
  jurisdiction?: string;
  depth?: number;
  mode?: "kyc_lite" | "full";
  canonicalName?: string;
  conversationId?: string;
  query?: string;
  user?: string;
  include_ownership?: boolean;
  include_adverse_media?: boolean;
  include_screening?: boolean;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const user = body.user || "veritas-demo";

  const inputs: Record<string, unknown> = {
    jurisdiction: body.jurisdiction || "United Kingdom",
    depth: body.depth ?? 3,
    mode: body.mode || "full",
  };
  if (body.canonicalName) inputs.canonical_name_input = body.canonicalName;
  // Capability flags → Dify select inputs as "true"/"false" strings (DSL gates compare to "false").
  if (body.include_ownership != null)
    inputs.include_ownership = body.include_ownership ? "true" : "false";
  if (body.include_adverse_media != null)
    inputs.include_adverse_media = body.include_adverse_media ? "true" : "false";
  if (body.include_screening != null)
    inputs.include_screening = body.include_screening ? "true" : "false";

  const query = body.query || body.company || "Investigate UBO";

  const encoder = new TextEncoder();
  // Abort the upstream Dify fetch if the client disconnects (so we don't leak a running agent).
  const upstream = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // Idle gaps to the client were measured up to ~27s during agent "thinking"; many proxies/
  // tunnels drop a connection idle for 30–60s. A clock-based heartbeat (independent of upstream
  // activity) keeps it warm so the terminal event always reaches the client.
  const HEARTBEAT_MS = 10_000;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          /* controller already closed by a cancel/disconnect — ignore */
        }
      };
      const send = (event: string, data: unknown) => enqueue(encoder.encode(sse(event, data)));
      const finish = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      heartbeat = setInterval(() => enqueue(encoder.encode(": ping\n\n")), HEARTBEAT_MS);

      let answer = "";
      let conversationId = body.conversationId || "";
      let messageId = "";
      const seenProgress = new Set<string>();

      try {
        for await (const ev of streamChat("ubo", {
          query,
          inputs,
          conversationId: body.conversationId,
          user,
          signal: upstream.signal,
        })) {
          if (ev.conversation_id) conversationId = ev.conversation_id;
          if (ev.message_id || ev.id) messageId = ev.message_id || ev.id || messageId;

          if (ev.event === "message" && typeof ev.answer === "string") {
            answer += ev.answer;
            // Emit each newly-completed progress line for the live "thinking" feel.
            for (const line of extractProgress(answer)) {
              if (!seenProgress.has(line)) {
                seenProgress.add(line);
                send("progress", { text: line });
              }
            }
          } else if (ev.event === "error") {
            send("error", { message: ev.message || "Agent error", code: "error" });
            finish();
            return;
          }
        }

        if (isDisambiguation(answer)) {
          // Turn 1: the agent returned a candidate list — let the analyst pick.
          send("candidates", { conversationId, candidates: parseCandidates(answer) });
        } else {
          const markdown = stripProgress(answer);
          // kyc_lite answers carry a ```json UboPayload → structured cards.
          // full answers are markdown → the report view. Send whichever we have.
          const { payload } = extractPayload(answer);
          send("done", {
            conversationId,
            messageId,
            markdown,
            header: extractReportHeader(markdown),
            payload: normalizeUboPayload(payload),
          });
        }
        finish();
      } catch (err) {
        // A client disconnect aborts the upstream → AbortError; nothing to report, just clean up.
        if ((err as Error)?.name === "AbortError") {
          finish();
          return;
        }
        if (err instanceof DifyError && err.isUnavailable) {
          send("error", {
            message:
              "The UBO agent is not currently published in the sandbox (app_unavailable).",
            code: "unavailable",
          });
        } else {
          send("error", {
            message: err instanceof Error ? err.message : "Unexpected error",
            code: "error",
          });
        }
        finish();
      }
    },
    cancel() {
      // Client went away (navigation / refresh / network drop): stop pinging and abort Dify.
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      upstream.abort();
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
