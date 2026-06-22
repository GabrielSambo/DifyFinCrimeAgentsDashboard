/*
  Server-side Dify client. Holds the app keys (from env) and never runs in the
  browser. Exposes a streaming chat call that yields parsed Dify SSE events.
*/

import "server-only";

const BASE = process.env.DIFY_API_BASE?.trim() ?? "";

export type DifyAgent = "ubo" | "kyc";

function keyFor(agent: DifyAgent): string {
  const key = (agent === "ubo" ? process.env.DIFY_UBO_APP_KEY : process.env.DIFY_KYC_APP_KEY)?.trim();
  if (!key) throw new Error(`Missing Dify app key for agent "${agent}"`);
  return key;
}

export interface ChatRequest {
  query: string;
  inputs?: Record<string, unknown>;
  conversationId?: string;
  user: string;
  /** Abort the upstream fetch (idle-timeout / cancellation). When it fires mid-stream the
   *  reader rejects with AbortError, which the caller maps to a friendly timeout. */
  signal?: AbortSignal;
}

/** A Dify streaming SSE event (advanced-chat mode). We only type the fields we use. */
export interface DifyEvent {
  event: string; // "message" | "message_end" | "error" | "ping" | "node_*" | ...
  answer?: string;
  conversation_id?: string;
  message_id?: string;
  id?: string;
  metadata?: Record<string, unknown>;
  code?: string;
  message?: string; // error message
  [k: string]: unknown;
}

/**
 * Call Dify in streaming mode and yield each decoded SSE event object.
 * Throws on a non-2xx HTTP response (caller maps to a friendly error).
 */
export async function* streamChat(
  agent: DifyAgent,
  req: ChatRequest,
): AsyncGenerator<DifyEvent> {
  const res = await fetch(`${BASE}/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keyFor(agent)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: req.inputs ?? {},
      query: req.query,
      response_mode: "streaming",
      conversation_id: req.conversationId || undefined,
      user: req.user,
    }),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new DifyError(res.status, text);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line.
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLine = chunk
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        yield JSON.parse(json) as DifyEvent;
      } catch {
        // Ignore keep-alive / malformed fragments.
      }
    }
  }
}

export class DifyError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Dify API ${status}`);
    this.name = "DifyError";
  }

  /** Dify returns app_unavailable when an app has unpublished blocking nodes. */
  get isUnavailable(): boolean {
    return this.status === 400 && /app_unavailable/.test(this.body);
  }
}
