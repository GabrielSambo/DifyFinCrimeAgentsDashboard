/* Browser-side helper: persist enrichment onto a client via the server PATCH proxy. */

import type { Cdd, CddHistoryEntry } from "@/lib/types";

export async function persistCdd(
  clientId: string,
  cddPatch: Partial<Cdd>,
  appendHistory?: CddHistoryEntry,
): Promise<{ ok: boolean; cdd?: Cdd; note?: string }> {
  try {
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cddPatch, appendHistory }),
    });
    return (await res.json()) as { ok: boolean; cdd?: Cdd; note?: string };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "persist failed" };
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
