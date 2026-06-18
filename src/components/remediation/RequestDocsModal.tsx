"use client";

import { useState } from "react";
import type { Client } from "@/lib/clients";
import { composeRfiDraft } from "@/lib/documents";
import type { RfiResult } from "@/app/api/rfi/route";
import { Spinner } from "@/components/ui/atoms";

/*
  Editable email-draft approval popup for the "Request documents" action (per the 2026-06-17 standup).
  The analyst reviews/edits recipient + subject + the requested-docs list, then Confirm → POST /api/rfi
  (which only sends when confirm:true). Nothing is emailed before Confirm.

  Fidelity note (shown in the UI): Agent 2 (the RFI engine) re-generates the final email HTML from the
  document list; this preview confirms recipient, subject, and which documents are requested. A faithful
  body preview would need a PREVIEW_RFI event on Agent 2 (future work).
*/

// Default recipient is a CONTROLLED placeholder — never auto-pulled from client data (it sends real mail).
const DEFAULT_TO = "demo-inbox@example.com";

export function RequestDocsModal({
  client,
  outstanding,
  onClose,
  onSent,
}: {
  client: Client;
  outstanding: string[];
  onClose: () => void;
  onSent: (result: RfiResult) => void;
}) {
  const draft = composeRfiDraft(client.full_name, outstanding);
  const [toEmail, setToEmail] = useState(DEFAULT_TO);
  const [subject, setSubject] = useState(draft.subject);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<RfiResult | null>(null);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail.trim());
  const isPlaceholder = toEmail.trim() === DEFAULT_TO;

  async function confirmSend() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/rfi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.client_id,
          toEmail: toEmail.trim(),
          subject: subject.trim(),
          missingDocuments: outstanding,
          confirm: true,
        }),
      });
      const r = (await res.json()) as RfiResult;
      setResult(r);
      if (r.ok) onSent(r);
    } catch {
      setResult({ ok: false, note: "Request failed" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-ink">Request documents</h3>
            <p className="mt-0.5 text-xs text-ink-3">{client.full_name} · {client.client_id}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-ink-3">
            The RFI engine generates the final email from the document list below; this preview confirms the
            recipient, subject, and which documents are requested. No email is sent until you confirm.
          </div>

          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">To</span>
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              className={`mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/15 ${
                toEmail.trim() && !emailValid ? "border-bad focus:border-bad" : "border-border-strong focus:border-brand"
              }`}
            />
            {toEmail.trim() && !emailValid && <span className="mt-1 block text-[11px] text-bad">Enter a valid email address.</span>}
            {isPlaceholder && <span className="mt-1 block text-[11px] text-warn">This is the placeholder address — change it to the client&apos;s real inbox before sending.</span>}
          </label>

          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>

          <div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Requested documents ({outstanding.length})
            </span>
            {outstanding.length ? (
              <ul className="mt-1 space-y-1 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm text-ink-2">
                {outstanding.map((d, i) => <li key={i}>• {d}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-3">No outstanding documents.</p>
            )}
          </div>

          <div className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Email preview — read-only (the RFI engine generates the final message)
            </span>
            <textarea
              value={draft.body}
              readOnly
              rows={6}
              className="mt-1 w-full cursor-default resize-none rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm text-ink-2 outline-none"
            />
          </div>

          {result && (
            <div className={`rounded-lg px-3 py-2 text-xs ${result.ok ? "bg-good-bg text-good" : "bg-surface-2 text-ink-2"}`}>
              {result.ok ? `Sent (${result.result ?? "ok"}).` : result.note ?? "Not sent."}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-ink-3 hover:text-ink-2">Cancel</button>
          <button
            onClick={() => void confirmSend()}
            disabled={sending || !emailValid || outstanding.length === 0 || result?.ok === true}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
          >
            {sending ? <Spinner /> : null}
            {result?.ok ? "Sent" : "Confirm & send"}
          </button>
        </footer>
      </div>
    </div>
  );
}
