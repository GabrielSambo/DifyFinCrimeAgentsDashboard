/*
  The KYC structured-envelope contract (v1).

  The KYC agent (Agente1-FIN V1) appends ONE fenced ```json block after its prose on the
  onboarding answer nodes. The route extracts it (reusing `extractPayload` from ubo-parse),
  this module normalizes it, and KycChat renders structured UI from `envelope.ui` instead of
  regex-scraping the agent's wording. See PRPs/ai_docs/kyc-envelope-transport-reference.md §1–§2.

  No Zod in the repo — this mirrors lib/ubo-normalize.ts's manual spread-and-default pattern and
  returns null when the minimum-viable fields are missing, so the caller falls back to plain prose.
*/

export type KycPhase =
  | "intake"
  | "profiling"
  | "collecting"
  | "screening"
  | "review"
  | "complete"
  | "qa"
  | "menu";

export interface KycOption {
  id: string;
  label: string;
  value: string;
  hint?: string;
}

export interface KycField {
  key: string;
  label: string;
  value: string;
  type: "text" | "date";
  required?: boolean;
}

export interface KycDocument {
  id: string;
  label: string;
  status: "required" | "received" | "na";
}

export interface KycEnvelope {
  phase: KycPhase;
  /** Clean prose for the chat bubble; authoritative (overrides the streamed text on `done`). */
  speak: string;
  progress?: { step: number; total: number; label: string };
  ui: {
    options?: KycOption[];
    fields?: KycField[];
    documents?: KycDocument[];
  };
  state?: { client_id?: string; client_type?: "PF" | "PJ"; profile?: string };
  actions?: Array<"verify_ownership" | "request_documents" | "complete">;
}

/**
 * Coerce the raw parsed JSON envelope to KycEnvelope, or null on anything malformed.
 * Minimum viable: `speak` and `phase` must be strings — otherwise we treat the message as
 * un-migrated prose (null → plain-text fallback in KycChat). Never throws.
 */
export function normalizeKycEnvelope(raw: unknown): KycEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.speak !== "string" || typeof r.phase !== "string") return null;

  const ui = (r.ui ?? {}) as Record<string, unknown>;
  const progress = r.progress as KycEnvelope["progress"] | undefined;

  return {
    phase: r.phase as KycPhase,
    speak: r.speak,
    progress:
      progress && typeof progress === "object" && typeof progress.step === "number"
        ? progress
        : undefined,
    ui: {
      options: Array.isArray(ui.options) ? (ui.options as KycOption[]) : undefined,
      fields: Array.isArray(ui.fields) ? (ui.fields as KycField[]) : undefined,
      documents: Array.isArray(ui.documents) ? (ui.documents as KycDocument[]) : undefined,
    },
    state: (r.state ?? undefined) as KycEnvelope["state"],
    actions: Array.isArray(r.actions) ? (r.actions as KycEnvelope["actions"]) : undefined,
  };
}
