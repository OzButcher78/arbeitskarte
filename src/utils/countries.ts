// Minimal country helper — the app is CH-only, but the scanner's redaction
// geometry (scanRedaction.ts) keys its default box off isSwiss(). Undefined /
// empty counts as Swiss (the app default).

const SWISS_TOKENS = new Set(['ch', 'che', 'schweiz', 'switzerland', 'suisse', 'svizzera']);

export function isSwiss(country?: string): boolean {
  const c = (country || '').trim().toLowerCase();
  if (!c) return true;
  return SWISS_TOKENS.has(c);
}
