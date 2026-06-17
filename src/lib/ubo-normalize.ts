/*
  Normalize the live kyc_lite `ubo_json` to the shape UboResults renders.
  The agent emits some fields the cards don't read directly:
    - turnover.value_gbp  → turnover.value
    - turnover.exceeds_36m "yes"|"no"|"unknown"  → boolean | null
  Everything else passes through untouched. Pure, safe on server or client.
*/

import type { UboPayload, Turnover } from "@/lib/types";

function normTurnover(t?: Turnover | null): Turnover | null | undefined {
  if (!t) return t;
  const value = t.value ?? t.value_gbp ?? null;
  const raw = t.exceeds_36m;
  const exceeds_36m =
    raw === true || raw === "yes" ? true : raw === false || raw === "no" ? false : null;
  return { ...t, value, exceeds_36m, currency: t.currency ?? "£" };
}

export function normalizeUboPayload(p: UboPayload | null | undefined): UboPayload | null {
  if (!p || typeof p !== "object") return null;
  return { ...p, turnover: normTurnover(p.turnover) };
}
