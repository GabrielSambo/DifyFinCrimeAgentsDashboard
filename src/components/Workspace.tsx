"use client";

import { useCallback, useState, type ReactNode } from "react";
import { KycChat } from "./kyc/KycChat";
import { UboPanel, type UboPrefill } from "./ubo/UboPanel";
import { Dashboard } from "./dashboard/Dashboard";
import { Remediation } from "./remediation/Remediation";
import { ClientProfile } from "./client/ClientProfile";
import type { Client, ClientsResponse } from "@/lib/clients";

type Tab = "dashboard" | "onboarding" | "profile" | "ownership" | "remediation";

const NAV: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <path d="M3 3h7v7H3V3zM14 3h7v7h-7V3zM14 14h7v7h-7v-7zM3 14h7v7H3v-7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  },
  {
    id: "onboarding",
    label: "KYC Assistant",
    icon: <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    id: "ownership",
    label: "Ownership",
    icon: <path d="M12 3v4M5 21v-4a2 2 0 012-2h10a2 2 0 012 2v4M5 21h4M15 21h4M10 7h4v3h-4V7zM3 17h4v4H3v-4zM17 17h4v4h-4v-4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    id: "remediation",
    label: "Remediation",
    icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

const TITLES: Record<Tab, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Client portfolio & document status" },
  onboarding: { title: "KYC Assistant", subtitle: "Onboard new clients & review existing ones" },
  profile: { title: "Client Profile", subtitle: "Consolidated due-diligence record" },
  ownership: { title: "Ownership", subtitle: "Beneficial-ownership tracing" },
  remediation: { title: "Remediation", subtitle: "Document remediation & ongoing monitoring" },
};

export function Workspace() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [prefill, setPrefill] = useState<UboPrefill | undefined>();
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  // Bumping this remounts <KycChat>, which is the reset: fresh state + a new convId ref → a brand-new
  // Dify conversation. Works mid-turn (escape hatch for a stuck/slow turn).
  const [chatNonce, setChatNonce] = useState(0);

  // Re-pull a client from the portfolio (mapped, incl. persisted cdd) by id.
  const refreshClient = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const data = (await res.json()) as ClientsResponse;
      const found = data.clients.find((c) => c.client_id === id);
      if (found) setActiveClient(found);
    } catch {
      /* keep the stale copy */
    }
  }, []);

  // Dashboard click → open the consolidated profile.
  function openClient(c: Client) {
    setActiveClient(c);
    setTab("profile");
  }

  // Profile "Run due diligence" → investigate AND persist back onto this client.
  function investigateClient(c: Client) {
    setPrefill({
      company: c.full_name,
      jurisdiction: c.jurisdiction || "United Kingdom",
      autorun: true,
      nonce: Date.now(),
      clientId: c.client_id,
      priorScreening: c.cdd?.screening?.summary ?? null,
    });
    setTab("ownership");
  }

  const meta = TITLES[tab];

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">V</div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-ink">Veritas</div>
            <div className="text-[11px] text-ink-3">Client Due Diligence</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === n.id ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="shrink-0">{n.icon}</svg>
              {n.label}
            </button>
          ))}

          {activeClient && (
            <button
              onClick={() => setTab("profile")}
              className={`mt-1 flex w-full items-center gap-3 rounded-lg border-t border-border px-3 pt-3 pb-2 text-sm font-medium transition-colors ${
                tab === "profile" ? "text-brand" : "text-ink-2 hover:text-ink"
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="shrink-0"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <span className="truncate">{activeClient.full_name}</span>
            </button>
          )}
        </nav>

        <div className="border-t border-border px-5 py-3 text-[11px] text-ink-3">
          Sandbox · live registry &amp; persistence
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-ink">{meta.title}</h1>
              <p className="text-xs text-ink-3">{meta.subtitle}</p>
            </div>
            {activeClient && tab === "ownership" && (
              <span className="ml-2 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-2">{activeClient.full_name}</span>
            )}
          </div>
          {/* Return to profile after enriching */}
          {tab === "ownership" && activeClient && prefill?.clientId && (
            <button
              onClick={() => void refreshClient(activeClient.client_id).then(() => setTab("profile"))}
              className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
            >
              ← Back to {activeClient.full_name}
            </button>
          )}
          {/* Return to the portfolio from a client profile */}
          {tab === "profile" && activeClient && (
            <button
              onClick={() => setTab("dashboard")}
              className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
            >
              ← Dashboard
            </button>
          )}
          {/* Restart a stuck/abandoned KYC conversation with a fresh Dify thread. */}
          {tab === "onboarding" && (
            <button
              onClick={() => setChatNonce((n) => n + 1)}
              title="Start a new KYC conversation"
              className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              New chat
            </button>
          )}
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value as Tab)}
            className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink md:hidden"
          >
            {NAV.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
            {activeClient && <option value="profile">{activeClient.full_name}</option>}
          </select>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "dashboard" && <Dashboard onOpenClient={openClient} />}
          {tab === "onboarding" && <KycChat key={chatNonce} />}
          {tab === "profile" && activeClient && <ClientProfile client={activeClient} onInvestigate={investigateClient} />}
          {tab === "profile" && !activeClient && (
            <div className="px-6 py-10 text-sm text-ink-3">Select a client from the Dashboard to view their profile.</div>
          )}
          {tab === "ownership" && <UboPanel prefill={prefill} />}
          {tab === "remediation" && <Remediation />}
        </div>
      </main>
    </div>
  );
}
