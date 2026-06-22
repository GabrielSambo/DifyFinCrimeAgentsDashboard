/*
  Frontend feature gates.

  HIDE_SCREENING (2026-06-22, pre-meeting): PEP / sanctions / adverse-screening is declared out of scope.
  When true, the UI hides every screening surface (Remediation "Screen sanctions" button + sweep + flagged
  tile, the Ownership screening cards/pills, the Client Profile screening card) AND stops the UBO agent from
  running PEP/sanctions screening (the include_screening flag is driven by !HIDE_SCREENING everywhere).

  This is a pure presentation/behaviour gate — the backend (/api/screen, the PEP Dify app, OpenSanctions)
  is untouched. Flip to false to restore the full screening experience in one place.
*/
export const HIDE_SCREENING = true;
