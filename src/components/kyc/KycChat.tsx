"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  KycEnvelope,
  KycField,
  KycOption,
  KycDocument,
} from "@/lib/kyc-envelope";
import { useUboInvestigation } from "@/components/ubo/useUboInvestigation";
import { UboCandidates } from "@/components/ubo/UboCandidates";
import { UboResults } from "@/components/ubo/UboResults";
import { Spinner } from "@/components/ui/atoms";
import { suggestionsFromUbo, type FieldSuggestion } from "@/lib/ubo-to-template";
import { parseSse } from "@/lib/sse";

interface Msg {
  role: "assistant" | "user";
  text: string;
  /** Structured envelope (migrated onboarding turns). When absent → plain-text render. */
  envelope?: KycEnvelope;
}

type Phase = "intro" | "form" | "chat";

interface KnownInputs {
  client_name?: string;
  client_id?: string;
  country?: string;
}

const GREETING =
  "I'm your KYC assistant. Tell me about a client — new or existing. I'll classify their profile, " +
  "pull their record if we already know them, and tell you exactly which documents are still required.";

const COUNTRIES = [
  "Spain",
  "United Kingdom",
  "Luxembourg",
  "Germany",
  "France",
  "Ireland",
  "United States",
];

export function KycChat() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Intake form
  const [fName, setFName] = useState("");
  const [fId, setFId] = useState("");
  const [fCountry, setFCountry] = useState(COUNTRIES[0]);
  // Intake values mirrored to state (the ref can't be read during render) so the
  // template form can prefill name / country / ID the analyst already entered.
  const [known, setKnown] = useState<KnownInputs | null>(null);
  // "Check existing client" id collection — shared by the launchpad card AND the greeting-menu
  // option, so neither ever sends an id-less "check existing" query (which misroutes/asks twice).
  const [existingIdOpen, setExistingIdOpen] = useState(false);
  const [existingId, setExistingId] = useState("");

  const convId = useRef<string>("");
  // Intake values are RESENT on every turn — Dify doesn't reliably carry start
  // inputs across turns, so the agent's country/name gates read them as empty
  // otherwise (verified against the live agent). The envelope `state` does NOT
  // replace this in slice 1.
  const formInputs = useRef<Record<string, unknown> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, phase]);

  async function send(value: string, display?: string) {
    const clean = value.trim();
    if (!clean || busy) return;
    setInput("");
    setError(null);
    setPhase("chat");
    setMessages((m) => [...m, { role: "user", text: display ?? clean }, { role: "assistant", text: "" }]);
    setBusy(true);

    const inputs = formInputs.current ?? {};

    try {
      const res = await fetch("/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: clean, inputs, conversationId: convId.current || undefined }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buf += decoder.decode(chunk, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const ev = parseSse(buf.slice(0, sep));
          buf = buf.slice(sep + 2);
          if (!ev) continue;
          if (ev.event === "delta") {
            const t = (ev.data as { text: string }).text;
            setMessages((m) => {
              const c = [...m];
              c[c.length - 1] = { ...c[c.length - 1], role: "assistant", text: c[c.length - 1].text + t };
              return c;
            });
          } else if (ev.event === "done") {
            const d = ev.data as { conversationId?: string; payload?: KycEnvelope | null };
            if (d.conversationId) convId.current = d.conversationId;
            // Migrated turn: attach the envelope and let `speak` own the bubble text.
            if (d.payload) {
              const env = d.payload;
              setMessages((m) => {
                const c = [...m];
                const last = c[c.length - 1];
                if (last?.role === "assistant") {
                  c[c.length - 1] = { ...last, text: env.speak, envelope: env };
                }
                return c;
              });
            }
          } else if (ev.event === "error") {
            setError((ev.data as { message: string }).message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
      setMessages((m) =>
        m[m.length - 1]?.role === "assistant" && !m[m.length - 1].text && !m[m.length - 1].envelope
          ? m.slice(0, -1)
          : m,
      );
    }
  }

  function submitIntake() {
    if (!fName.trim()) return;
    const intake = {
      client_name: fName.trim(),
      client_id: fId.trim(),
      country: fCountry,
    };
    formInputs.current = intake;
    setKnown(intake);
    const parts = [`Client intake. Name: ${fName.trim()}`];
    if (fId.trim()) parts.push(`ID: ${fId.trim()}`);
    parts.push(`Country: ${fCountry}.`);
    const display = `Start intake — ${fName.trim()} · ${fCountry}`;
    void send(parts.join(", "), display);
  }

  function openExistingLookup() {
    setExistingIdOpen(true);
  }

  function submitExistingLookup() {
    const id = existingId.trim();
    if (!id || busy) return;
    setExistingIdOpen(false);
    setExistingId("");
    void send(`Check existing client. Identifier: ${id}`, `Check existing: ${id}`);
  }

  function cancelExistingLookup() {
    setExistingIdOpen(false);
    setExistingId("");
  }

  // Interactive envelope UI (options / fill-in form) renders for the most recent
  // assistant message only — older turns keep just their prose bubble.
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return i;
    return -1;
  }, [messages]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.map((m, i) => {
          const isLastAssistant = i === lastAssistantIdx && !busy;
          const env = m.envelope;
          const showInteractive = isLastAssistant && !!env;
          const options = showInteractive ? env!.ui.options ?? [] : [];
          const fields = showInteractive ? env!.ui.fields ?? [] : [];
          // Gate documents to the current turn too (was rendering on every past bubble).
          const documents = showInteractive ? env!.ui.documents ?? [] : [];
          return (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className="max-w-[88%]">
                {m.role === "assistant" && (
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-brand text-[9px] text-white">V</span>
                    KYC Assistant
                  </div>
                )}

                {/* Progress indicator (envelope only) */}
                {env?.progress && i === lastAssistantIdx && <ProgressBar progress={env.progress} />}

                <div
                  className={
                    m.role === "user"
                      ? "rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white"
                      : "rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-2.5 text-sm leading-relaxed text-ink"
                  }
                >
                  {m.text ? <Markdown text={m.text} /> : <TypingDots />}
                </div>

                {/* Clickable options (envelope.ui.options) */}
                {options.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {options.map((o: KycOption) => (
                      <button
                        key={o.id}
                        onClick={() =>
                          env?.phase === "menu" && o.id === "existing"
                            ? openExistingLookup()
                            : send(o.value, o.label)
                        }
                        title={o.hint}
                        className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm text-ink-2 hover:border-brand hover:bg-brand-50 hover:text-brand"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Required-documents checklist (envelope.ui.documents) */}
                {documents.length > 0 && (
                  <div className="mt-2 rounded-xl border border-border bg-surface p-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                      Required documentation
                    </div>
                    <ul className="space-y-1.5">
                      {documents.map((d: KycDocument) => (
                        <li key={d.id} className="flex items-start gap-2 text-sm text-ink-2">
                          <DocStatusIcon status={d.status} />
                          <span className={d.status === "na" ? "text-ink-3 line-through" : ""}>{d.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Fill-in fields (envelope.ui.fields) → interactive form */}
                {fields.length > 0 && (
                  <TemplateForm
                    fields={fields}
                    known={known}
                    busy={busy}
                    clientType={env?.state?.client_type}
                    onSubmit={(payload) => send(payload, payload)}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Capability launchpad (empty state) / intake form */}
        {phase === "intro" && (
          <KycLaunchpad
            onOnboard={() => setPhase("form")}
            onCheckExisting={openExistingLookup}
            onAskQuestion={() => inputRef.current?.focus()}
            existingIdOpen={existingIdOpen}
            existingId={existingId}
            onExistingIdChange={setExistingId}
            onSubmitExisting={submitExistingLookup}
            onCancelExisting={cancelExistingLookup}
            busy={busy}
          />
        )}

        {phase === "form" && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="text-sm font-semibold text-ink">Client intake</div>
            <p className="mt-0.5 text-xs text-ink-3">We&apos;ll check the registry — new clients start onboarding, existing ones continue where they left off.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Client name" required>
                <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. ALDI STORES LIMITED"
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
              </Field>
              <Field label="ID (DNI / NIE / NIF / CIF)">
                <input value={fId} onChange={(e) => setFId(e.target.value)} placeholder="optional"
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
              </Field>
              <Field label="Country">
                <select value={fCountry} onChange={(e) => setFCountry(e.target.value)}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15">
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={submitIntake} disabled={!fName.trim()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">
                Begin intake
              </button>
              <button onClick={() => setPhase("intro")} className="rounded-lg px-3 py-2 text-sm text-ink-3 hover:text-ink-2">
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>
        )}
      </div>

      {/* "Check existing client" id prompt for the greeting-menu option. In the intro empty
          state the launchpad renders its own copy directly below the 3 cards. */}
      {existingIdOpen && phase !== "intro" && (
        <ExistingIdInput
          className="flex items-center gap-2 border-t border-border pt-3"
          value={existingId}
          onChange={setExistingId}
          onSubmit={submitExistingLookup}
          onCancel={cancelExistingLookup}
          busy={busy}
        />
      )}

      <form
        className="border-t border-border py-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a reply, or ask anything…"
            disabled={busy}
            className="flex-1 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
          />
          <button type="submit" disabled={!input.trim() || busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">
            Send
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-ink-3">Live agent · Agente1-FIN V1 (Dify sandbox)</p>
      </form>
    </div>
  );
}

/**
 * Empty-state capability launchpad: 3 cards that steer the analyst to a supported lane
 * (onboard / check existing / ask a policy question) while leaving free text open below.
 * "Check existing" opens the shared identifier input (see existingIdOpen) so the frontend
 * collects the id and the existing lookup→review lane can run — the same input the greeting
 * menu's "Check an existing client" option opens.
 */
function KycLaunchpad({
  onOnboard,
  onCheckExisting,
  onAskQuestion,
  existingIdOpen,
  existingId,
  onExistingIdChange,
  onSubmitExisting,
  onCancelExisting,
  busy,
}: {
  onOnboard: () => void;
  onCheckExisting: () => void;
  onAskQuestion: () => void;
  existingIdOpen: boolean;
  existingId: string;
  onExistingIdChange: (v: string) => void;
  onSubmitExisting: () => void;
  onCancelExisting: () => void;
  busy: boolean;
}) {
  const cardCls =
    "flex flex-col items-start gap-1 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-brand";

  return (
    <div className="pl-1">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">What would you like to do?</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={onOnboard} className={cardCls}>
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
          </span>
          <span className="text-sm font-medium text-ink">Onboard a new client</span>
          <span className="text-xs text-ink-3">Classify the profile, collect details, and register.</span>
        </button>
        <button type="button" onClick={onCheckExisting} className={cardCls}>
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </span>
          <span className="text-sm font-medium text-ink">Check an existing client</span>
          <span className="text-xs text-ink-3">Pull a KYC record we already hold.</span>
        </button>
        <button type="button" onClick={onAskQuestion} className={cardCls}>
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1.2-1.5 2.2M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span className="text-sm font-medium text-ink">Ask a policy question</span>
          <span className="text-xs text-ink-3">Get a quick answer on KYC policy.</span>
        </button>
      </div>

      {existingIdOpen && (
        <ExistingIdInput
          className="mt-2 flex items-center gap-2"
          value={existingId}
          onChange={onExistingIdChange}
          onSubmit={onSubmitExisting}
          onCancel={onCancelExisting}
          busy={busy}
        />
      )}

      <p className="mt-2 text-xs text-ink-3">…or just type your request below.</p>
    </div>
  );
}

/** Inline "look up an existing client by name/ID" input — reused by the launchpad (below the
 *  cards in the empty state) and the greeting-menu "Check an existing client" option. */
function ExistingIdInput({
  className,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  className?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Client name or ID to look up"
        className="flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      <button
        type="submit"
        disabled={!value.trim() || busy}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
      >
        Look up
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-2 py-2 text-sm text-ink-3 hover:text-ink-2"
      >
        Cancel
      </button>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">
        {label} {required && <span className="text-bad">*</span>}
      </span>
      {children}
    </label>
  );
}

function ProgressBar({ progress }: { progress: NonNullable<KycEnvelope["progress"]> }) {
  const pct = progress.total > 0 ? Math.round((progress.step / progress.total) * 100) : 0;
  return (
    <div className="mb-1.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
        <span>{progress.label}</span>
        <span>
          Step {progress.step} of {progress.total}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DocStatusIcon({ status }: { status: KycDocument["status"] }) {
  if (status === "received") {
    return (
      <svg className="mt-0.5 shrink-0 text-good" width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "na") {
    return (
      <svg className="mt-0.5 shrink-0 text-ink-3" width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="mt-0.5 shrink-0 text-ink-3" width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/* ── DD/MM/YYYY ⇄ YYYY-MM-DD helpers for native date inputs ──────────────────── */

/** DD/MM/YYYY → YYYY-MM-DD for the native date input; "" if not representable. */
function toDateInputValue(v: string): string {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

/** YYYY-MM-DD → DD/MM/YYYY for the submit payload; passthrough otherwise. */
function fromDateInputValue(v: string): string {
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v.trim();
}

/**
 * The agent sends fields all-blank, so prefill empty fields from what the analyst already
 * entered at intake (name / country / ID). Agent-provided values win; we only fill genuinely
 * empty fields. Returns "" when nothing matches.
 */
function prefillFor(field: KycField, known: KnownInputs | null): string {
  if (!known) return "";
  const l = `${field.key} ${field.label}`.toLowerCase();
  if (known.client_name && /legal name|full name|\bname\b|nombre|raz[oó]n social/.test(l))
    return known.client_name;
  if (known.country && /country|jurisdic|incorporation|pa[ií]s/.test(l)) return known.country;
  if (known.client_id && /registration|identif|\bid\b|dni|nie|nif|cif/.test(l)) return known.client_id;
  return "";
}

/**
 * Renders the envelope's `fields` as a form: one input per field, prefilled where the agent
 * already knows the value (or from intake), a native date picker for date fields. On submit,
 * non-empty fields are posted back as "Label: Value" lines (the tolerant agent parser accepts
 * this), and the payload doubles as the user-bubble text so there's a record of what was sent.
 */
type FieldStatus = "empty" | "manual" | "suggested" | "accepted" | "edited";
interface FieldState {
  value: string;
  status: FieldStatus;
  suggestion?: FieldSuggestion;
}

function TemplateForm({
  fields,
  known,
  busy,
  clientType,
  onSubmit,
}: {
  fields: KycField[];
  known: KnownInputs | null;
  busy: boolean;
  clientType?: "PF" | "PJ";
  onSubmit: (payload: string) => void;
}) {
  const [states, setStates] = useState<FieldState[]>(() =>
    fields.map((f) => {
      const v0 = f.value || prefillFor(f, known);
      const value = f.type === "date" ? toDateInputValue(v0) : v0;
      return { value, status: value ? "manual" : "empty" };
    }),
  );

  // One UBO run per template. No opts → no persist (the onboarding client isn't registered yet).
  const ubo = useUboInvestigation();
  // null = a full "Auto-fill"; a number = a single-field re-search (only that field updates).
  const reSearchIdx = useRef<number | null>(null);

  // Auto-fill only makes sense for a company. Gate on client_type, else fall back to a
  // company-ish field set (legal form / registration / incorporation present).
  const looksCompany =
    clientType === "PJ" ||
    fields.some((f) => /legal.?form|registration|company.?number|incorporat/i.test(`${f.key} ${f.label}`));
  const canAutofill = looksCompany && !!known?.client_name?.trim();
  const uboBusy = ubo.state === "resolving" || ubo.state === "running";

  // When a payload arrives, map it to suggestions and merge — never clobbering accepted/edited fields.
  useEffect(() => {
    if (!ubo.payload) return;
    const sugg = suggestionsFromUbo(ubo.payload, fields);
    const onlyIdx = reSearchIdx.current;
    reSearchIdx.current = null;
    setStates((prev) =>
      prev.map((st, i) => {
        if (onlyIdx != null && i !== onlyIdx) return st; // re-search touches one field
        if (st.status === "edited" || st.status === "accepted") return st; // respect analyst input
        const s = sugg[fields[i].key];
        if (!s) return st;
        const value = fields[i].type === "date" ? toDateInputValue(s.value) : s.value;
        return { value, status: "suggested", suggestion: s };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubo.payload]);

  function startLookup(idx: number | null) {
    if (!known?.client_name?.trim()) return;
    reSearchIdx.current = idx;
    ubo.start({
      company: known.client_name.trim(),
      jurisdiction: known.country ?? "United Kingdom",
      depth: 3,
      flags: { include_ownership: true, include_adverse_media: true, include_screening: true },
    });
  }

  function setVal(i: number, v: string) {
    setStates((prev) =>
      prev.map((st, j) => (j === i ? { value: v, status: v ? "edited" : "empty", suggestion: undefined } : st)),
    );
  }
  function acceptField(i: number) {
    setStates((prev) => prev.map((st, j) => (j === i && st.status === "suggested" ? { ...st, status: "accepted" } : st)));
  }
  function rejectField(i: number) {
    setStates((prev) => prev.map((st, j) => (j === i ? { value: "", status: "empty", suggestion: undefined } : st)));
  }
  function acceptAll() {
    setStates((prev) => prev.map((st) => (st.status === "suggested" ? { ...st, status: "accepted" } : st)));
  }

  const suggestedCount = states.filter((s) => s.status === "suggested").length;
  const hasRequiredGap = fields.some((f, i) => f.required && !states[i].value.trim());
  const hasAny = states.some((s) => s.value.trim());

  const inputCls =
    "w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

  function submit() {
    const lines = fields
      .map((f, i) => {
        const raw = states[i].value.trim();
        if (!raw) return null;
        return `${f.label}: ${f.type === "date" ? fromDateInputValue(raw) : raw}`;
      })
      .filter((l): l is string => l !== null);
    if (!lines.length) return;
    onSubmit(lines.join("\n"));
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Complete the client profile</div>
        {canAutofill && (
          <button
            onClick={() => startLookup(null)}
            disabled={uboBusy || busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-50/70 disabled:opacity-50"
          >
            {uboBusy ? <Spinner className="text-brand" /> : <span aria-hidden>✨</span>}
            {uboBusy ? "Looking up…" : "Auto-fill from registries"}
          </button>
        )}
      </div>

      {/* Streamed progress step-list (buys patience vs a bare spinner). */}
      {uboBusy && (
        <div className="mb-3 rounded-lg border border-border bg-surface-2/50 p-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-2">
            <Spinner className="text-brand" />
            {ubo.state === "resolving" ? "Resolving the entity in the registries…" : "Pulling company details, ownership & screening…"}
          </div>
          {ubo.progress.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {ubo.progress.map((line, i) => (
                <li key={i} className="flex items-center gap-2 text-[11px] text-ink-3">
                  <span className="h-1 w-1 rounded-full bg-good" />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Entity picker on ambiguous match. */}
      {ubo.state === "choosing" && (
        <div className="mb-3">
          <UboCandidates candidates={ubo.candidates} onSelect={ubo.selectCandidate} onSearchAgain={ubo.searchAgain} />
        </div>
      )}

      {ubo.state === "error" && ubo.error && (
        <div className="mb-3 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-xs text-bad">
          Couldn’t auto-fill: {ubo.error} — enter the details manually or retry.
        </div>
      )}

      {suggestedCount > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-brand-50/60 px-2.5 py-1.5 text-xs text-ink-2">
          <span>
            {suggestedCount} field{suggestedCount > 1 ? "s" : ""} pre-filled from registries — review &amp; accept.
          </span>
          <button onClick={acceptAll} className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-600">
            Accept all
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f, i) => {
          const st = states[i];
          const isSug = st.status === "suggested";
          const borderCls = isSug ? "border-brand/50 ring-1 ring-brand/15" : "border-border-strong";
          return (
            <div key={f.key}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="block text-xs font-medium text-ink-2">
                  {f.label} {f.required && <span className="text-bad">*</span>}
                </span>
                {st.suggestion?.source && (isSug || st.status === "accepted") && (
                  <span
                    className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      st.status === "accepted" ? "bg-good-bg text-good" : "bg-brand-50 text-brand"
                    }`}
                    title={st.suggestion.sourceUrl}
                  >
                    {st.status === "accepted" ? "✓ " : ""}
                    {st.suggestion.source}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type={f.type === "date" ? "date" : "text"}
                  value={st.value}
                  onChange={(e) => setVal(i, e.target.value)}
                  className={`${inputCls} ${borderCls}`}
                />
                {canAutofill && (
                  <button
                    type="button"
                    title="Re-search this field"
                    onClick={() => startLookup(i)}
                    disabled={uboBusy}
                    className="shrink-0 rounded-md border border-border-strong p-1.5 text-ink-3 hover:border-brand hover:text-brand disabled:opacity-40"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              {isSug && (
                <div className="mt-1 flex items-center gap-3 text-[11px]">
                  <button onClick={() => acceptField(i)} className="font-medium text-good hover:underline">
                    Accept
                  </button>
                  <button onClick={() => rejectField(i)} className="text-ink-3 hover:text-bad hover:underline">
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || uboBusy || !hasAny || hasRequiredGap}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
        >
          Submit profile
        </button>
        {suggestedCount > 0 && <span className="text-[11px] text-ink-3">{suggestedCount} field(s) still to review</span>}
      </div>

      {/* Enrichment block — UBOs / ownership / directors / screening from the same lookup. */}
      {ubo.payload && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">Ownership &amp; screening</div>
          <UboResults payload={ubo.payload} />
        </div>
      )}
    </div>
  );
}

/* ── Markdown bubble ──────────────────────────────────────────────────────────
   Replaces the hand-rolled renderText(). react-markdown + remark-gfm, NO rehype-raw
   (the text is LLM output — never render raw HTML). Mirrors UboReport.tsx usage. */

const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-ink-3">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
};

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-1 py-0.5">
      {["0s", "0.2s", "0.4s"].map((d) => (
        <span key={d} className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-veritas-pulse" style={{ animationDelay: d }} />
      ))}
    </div>
  );
}
