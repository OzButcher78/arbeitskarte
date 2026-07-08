// ============================================================================
// Job numbering (§5.6) — flat single counter, auto/manual switchable.
// Minting uses Math.max(counter, dbMax + 1) so a manually-typed or imported
// higher number can never be re-issued. (No vault reconciliation — single
// device.)
// ============================================================================

/** Format e.g. ("AK", 7) → "AK-007". A trailing dash in the prefix is respected. */
export function formatJobNumber(prefix: string, n: number): string {
  const clean = prefix.trim();
  const sep = clean === '' || clean.endsWith('-') ? '' : '-';
  return `${clean}${sep}${String(n).padStart(3, '0')}`;
}

/** Parse the numeric suffix out of a job number that matches the prefix. */
export function parseJobNumber(prefix: string, jobNumber: string): number | null {
  const clean = prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sep = clean === '' || clean.endsWith('-') ? '' : '-?';
  const re = new RegExp(`^${clean}${sep}0*(\\d+)$`);
  const m = jobNumber.trim().match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
