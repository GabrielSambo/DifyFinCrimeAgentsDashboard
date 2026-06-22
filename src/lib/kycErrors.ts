/*
  KYC chat error copy — maps a stable error `code` to human, actionable copy for the chat UI.

  PURE module: NO "server-only" import. It is consumed by the client component (KycChat.tsx) AND
  the codes it speaks are emitted by the server route (/api/kyc). Keep the code set in sync with
  the route's mapping and PRPs/ai_docs/sse-keepalive-and-timeouts.md (single source of truth).

  Principle: name the likely cause in plain language, reassure (not the analyst's fault / progress
  saved), and always offer a next step. Never surface a bare status like "504" as the headline —
  the raw detail lives in `technical` behind a collapsible.
*/

export type KycErrorCode =
  | "timeout"
  | "rate_limit"
  | "unavailable"
  | "server"
  | "network"
  | "error";

export interface FriendlyError {
  title: string;
  body: string;
  canRetry: boolean;
  /** Raw status/message, shown in a small collapsible for the team — never the headline. */
  technical?: string;
}

export function friendlyError(code: KycErrorCode, technical?: string): FriendlyError {
  switch (code) {
    case "timeout":
      return {
        title: "This is taking longer than usual",
        body:
          "The ownership and screening lookups behind a KYC check can be slow, and this one ran past our limit. Your progress is saved — please try again.",
        canRetry: true,
        technical,
      };
    case "rate_limit":
      return {
        title: "A bit too busy right now",
        body: "Too many requests are in flight. Give it about 20 seconds, then try again.",
        canRetry: true,
        technical,
      };
    case "unavailable":
      return {
        title: "The KYC assistant isn’t available here yet",
        body:
          "This environment hasn’t published the KYC agent. Nothing you did wrong — ping the team to enable it.",
        canRetry: false,
        technical,
      };
    case "server":
      return {
        title: "Something broke on our side",
        body: "That’s on us, not your input — we’ve logged it. You can try again.",
        canRetry: true,
        technical,
      };
    case "network":
      return {
        title: "Connection interrupted",
        body: "Looks like the connection dropped. Check your network, then try again.",
        canRetry: true,
        technical,
      };
    case "error":
    default:
      return {
        title: "That didn’t go through",
        body: "Something unexpected happened. Please try again.",
        canRetry: true,
        technical,
      };
  }
}

/**
 * Derive a code from a non-2xx initial /api/kyc response. This is the path a Vercel function
 * hard-kill (exceeded maxDuration) takes — it returns a raw status with no SSE `code`.
 */
export function codeFromStatus(status: number): KycErrorCode {
  if (status === 504 || status === 502 || status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "error";
}
