/*
  Deterministic, explainable client risk derivation. One pure function, reused by the
  persistence proxy and the dashboard so risk is computed in exactly one place.

  Precedence (top wins):
    alert    — any screened party is a sanctions / PEP / debarment hit
    review   — a possible screening match, OR adverse media, OR turnover > £36M MSA threshold,
               OR ownership left unresolved (information gaps)
    cleared  — screened with zero hits
    pending  — never screened
*/

import type { RiskStatus } from "@/lib/clients";
import type { UboPayload, ScreenSummary } from "@/lib/types";

export type { ScreenSummary };

export interface RiskVerdict {
  status: RiskStatus;
  summary: string;
}

function hitTotal(s?: ScreenSummary): number {
  if (!s) return 0;
  return (s.pep_hits || 0) + (s.sanctions_hits || 0) + (s.debarment_hits || 0);
}

export function deriveRisk(screening?: ScreenSummary | null, ubo?: UboPayload | null): RiskVerdict {
  const hasScreen = !!screening && (screening.screened ?? 0) >= 0 && (screening.screened ?? 0) > 0;
  const hits = hitTotal(screening ?? undefined);

  // 1) Confirmed sanctions / PEP / debarment → alert
  if (hits > 0) {
    const parts: string[] = [];
    if (screening?.sanctions_hits) parts.push(`${screening.sanctions_hits} sanctions`);
    if (screening?.pep_hits) parts.push(`${screening.pep_hits} PEP`);
    if (screening?.debarment_hits) parts.push(`${screening.debarment_hits} debarment`);
    const who = screening?.highest_risk ? ` — ${screening.highest_risk}` : "";
    return { status: "alert", summary: `Screening hit: ${parts.join(" · ")}${who}` };
  }

  // 2) Soft signals → review
  const adverse = (ubo?.adverse_media?.length ?? 0) > 0;
  const candidates = screening?.candidates ?? 0;
  const overTurnover = ubo?.turnover?.exceeds_36m === true || (ubo?.turnover as { exceeds_36m?: string })?.exceeds_36m === "yes";
  const gaps = (ubo?.information_gaps?.length ?? 0) > 0;
  if (candidates > 0 || adverse || overTurnover || gaps) {
    const reasons: string[] = [];
    if (candidates > 0) reasons.push(`${candidates} possible screening match(es)`);
    if (adverse) reasons.push(`${ubo!.adverse_media!.length} adverse-media item(s)`);
    if (overTurnover) reasons.push("turnover above £36M (MSA in scope)");
    if (gaps) reasons.push("unresolved ownership");
    return { status: "review", summary: `Needs review: ${reasons.join(" · ")}` };
  }

  // 3) Screened clean
  if (hasScreen || ubo) {
    return { status: "cleared", summary: "Screened — no PEP/sanctions hits, no adverse signals" };
  }

  // 4) Never screened
  return { status: "pending", summary: "Screening not yet run" };
}
