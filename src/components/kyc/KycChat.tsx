"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  detectOptions,
  detectDocuments,
  detectTemplate,
  toDateInputValue,
  fromDateInputValue,
  type Option,
  type TemplateField,
} from "@/lib/kyc-options";

interface Msg {
  role: "assistant" | "user";
  text: string;
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

export function KycChat({
  onHandoff,
}: {
  onHandoff: (h: { company: string; jurisdiction: string }) => void;
}) {
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

  const convId = useRef<string>("");
  // Intake values are RESENT on every turn — Dify doesn't reliably carry start
  // inputs across turns, so the agent's country/name gates read them as empty
  // otherwise (verified against the live agent).
  const formInputs = useRef<Record<string, unknown> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
              c[c.length - 1] = { role: "assistant", text: c[c.length - 1].text + t };
              return c;
            });
          } else if (ev.event === "done") {
            const d = ev.data as { conversationId: string };
            if (d.conversationId) convId.current = d.conversationId;
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
        m[m.length - 1]?.role === "assistant" && !m[m.length - 1].text ? m.slice(0, -1) : m,
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

  // Options + documents are computed for the most recent assistant message only.
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return i;
    return -1;
  }, [messages]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.map((m, i) => {
          const isLastAssistant = i === lastAssistantIdx && !busy;
          const opts = isLastAssistant ? detectOptions(m.text) : { kind: "none" as const, options: [] };
          const tpl =
            isLastAssistant && opts.kind === "none"
              ? detectTemplate(m.text)
              : { preamble: "", fields: [] as TemplateField[] };
          const docs =
            isLastAssistant && opts.kind === "none" && tpl.fields.length === 0
              ? detectDocuments(m.text)
              : [];
          const display =
            tpl.fields.length > 0
              ? tpl.preamble
              : trimToPreamble(m.text, opts.options.length > 0, docs.length > 0);
          return (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className="max-w-[88%]">
                {m.role === "assistant" && (
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-brand text-[9px] text-white">V</span>
                    KYC Assistant
                  </div>
                )}
                <div
                  className={
                    m.role === "user"
                      ? "rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white"
                      : "rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-2.5 text-sm leading-relaxed text-ink"
                  }
                >
                  {m.text ? renderText(display) : <TypingDots />}
                </div>

                {/* Clickable options */}
                {opts.options.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {opts.options.map((o: Option) => (
                      <button
                        key={o.label}
                        onClick={() => send(o.value, o.label)}
                        title={o.hint}
                        className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm text-ink-2 hover:border-brand hover:bg-brand-50 hover:text-brand"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Required-documents checklist */}
                {docs.length > 0 && (
                  <div className="mt-2 rounded-xl border border-border bg-surface p-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                      Required documentation
                    </div>
                    <ul className="space-y-1.5">
                      {docs.map((d, di) => (
                        <li key={di} className="flex items-start gap-2 text-sm text-ink-2">
                          <svg className="mt-0.5 shrink-0 text-ink-3" width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/></svg>
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Fill-in template → interactive form */}
                {tpl.fields.length > 0 && (
                  <TemplateForm
                    fields={tpl.fields}
                    known={known}
                    busy={busy}
                    onSubmit={(payload) => send(payload, payload)}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Intro CTA / intake form */}
        {phase === "intro" && (
          <div className="pl-1">
            <button
              onClick={() => setPhase("form")}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
              Start intake
            </button>
            <span className="ml-3 text-xs text-ink-3">…or ask a KYC question below.</span>
          </div>
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

      {/* Handoff affordance */}
      <div className="flex items-center justify-between gap-3 border-t border-border py-2.5">
        <span className="text-xs text-ink-3">Need to verify ownership?</span>
        <button
          onClick={() => onHandoff({ company: fName.trim(), jurisdiction: fCountry })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-brand hover:border-brand hover:bg-brand-50"
        >
          Run ownership investigation
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <form
        className="border-t border-border py-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <input
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

/**
 * Renders a fill-in template as a form: one input per field, prefilled where the agent
 * already knows the value, a native date picker for date fields. A blank line ("____")
 * becomes an empty input — never shown as raw text. On submit, non-empty fields are
 * posted back as "Label: Value" lines (the tolerant agent parser accepts this), and the
 * payload doubles as the user-bubble text so there's a permanent record of what was sent.
 */
/**
 * The agent often returns the template all-blank, so prefill empty fields from what the
 * analyst already entered at intake (name / country / ID). Agent-provided values win; we
 * only fill genuinely empty fields. Returns "" when nothing matches.
 */
function prefillFor(label: string, known: KnownInputs | null): string {
  if (!known) return "";
  const l = label.toLowerCase();
  if (known.client_name && /legal name|full name|\bname\b|nombre|raz[oó]n social/.test(l))
    return known.client_name;
  if (known.country && /country|jurisdic|pa[ií]s/.test(l)) return known.country;
  if (known.client_id && /registration|identif|\bid\b|dni|nie|nif|cif/.test(l)) return known.client_id;
  return "";
}

function TemplateForm({
  fields,
  known,
  busy,
  onSubmit,
}: {
  fields: TemplateField[];
  known: KnownInputs | null;
  busy: boolean;
  onSubmit: (payload: string) => void;
}) {
  const [vals, setVals] = useState<string[]>(() =>
    fields.map((f) => {
      const v = f.value || prefillFor(f.label, known);
      return f.type === "date" ? toDateInputValue(v) : v;
    }),
  );

  const inputCls =
    "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

  const hasAny = vals.some((v) => v.trim());

  function submit() {
    const lines = fields
      .map((f, i) => {
        const raw = vals[i].trim();
        if (!raw) return null;
        return `${f.label}: ${f.type === "date" ? fromDateInputValue(raw) : raw}`;
      })
      .filter((l): l is string => l !== null);
    if (!lines.length) return;
    onSubmit(lines.join("\n"));
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        Complete the client profile
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f, i) => (
          <Field key={i} label={f.displayLabel}>
            <input
              type={f.type === "date" ? "date" : "text"}
              value={vals[i]}
              onChange={(e) =>
                setVals((prev) => {
                  const next = [...prev];
                  next[i] = e.target.value;
                  return next;
                })
              }
              className={inputCls}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3">
        <button
          onClick={submit}
          disabled={busy || !hasAny}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
        >
          Submit profile
        </button>
      </div>
    </div>
  );
}

/** When we render buttons/checklists, keep only the agent's lead-in text. */
function trimToPreamble(text: string, hasOptions: boolean, hasDocs: boolean): string {
  if (!hasOptions && !hasDocs) return text;
  const lines = text.split("\n");
  const isListLine = (l: string) =>
    /^\s*\d+[).]\s+/.test(l) || /^\s*[-*•]\s+/.test(l) || /^\s*(reply like this|responde as[íi]|reply:)/i.test(l.trim());
  const idx = lines.findIndex(isListLine);
  if (idx <= 0) return text;
  return lines.slice(0, idx).join("\n").trim();
}

function parseSse(block: string): { event: string; data: unknown } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

function renderText(text: string) {
  return text.split("\n").map((line, i) => (
    <p key={i} className={i > 0 ? "mt-2" : ""}>
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </p>
  ));
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
