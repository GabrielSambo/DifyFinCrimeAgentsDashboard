/*
  Derived KYC review status. The analyst sets a review CADENCE (in days) per client; the next-review
  date is computed = anchor + cadence, where anchor is the last-screened date (falls back to created_at).
  This auto-advances every time the client is re-screened (perpetual KYC). Nothing is hardcoded — the
  cadence is a real, analyst-entered value; "due/overdue" derives from it + a real screening date.
*/

import { formatDate } from "./format";

export interface ReviewStatus {
  label: string;
  tone: "bad" | "warn" | "muted";
  overdue: boolean;
  /** Derived next-review date (ISO), or null when there's no anchor date yet. */
  dueDate: string | null;
}

const DAY_MS = 86_400_000;

/** UTC midnight epoch for a date — so server and client agree (no hydration drift). */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * @param cadenceDays analyst-set review interval (days). Falsy/<=0 ⇒ no review tracked (null).
 * @param anchorIso   the date to count from (last screened, else onboarding date).
 */
export function reviewStatus(cadenceDays?: number | null, anchorIso?: string | null): ReviewStatus | null {
  if (!cadenceDays || cadenceDays <= 0) return null;

  if (!anchorIso) {
    return { label: `Review every ${cadenceDays}d · not screened yet`, tone: "muted", overdue: false, dueDate: null };
  }
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return null;

  const dueMs = utcDay(anchor) + cadenceDays * DAY_MS;
  const dueIso = new Date(dueMs).toISOString();
  const days = Math.round((dueMs - utcDay(new Date())) / DAY_MS);

  if (days < 0) return { label: `Review ${Math.abs(days)}d overdue`, tone: "bad", overdue: true, dueDate: dueIso };
  if (days === 0) return { label: "Review due today", tone: "warn", overdue: false, dueDate: dueIso };
  if (days <= 30) return { label: `Review due in ${days}d`, tone: "warn", overdue: false, dueDate: dueIso };
  return { label: `Review due ${formatDate(dueIso)}`, tone: "muted", overdue: false, dueDate: dueIso };
}
