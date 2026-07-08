// ============================================================================
// CREDENTIAL STORE — the document-scanner BYO API key (doc_scan_key).
// ----------------------------------------------------------------------------
// The only secret this app holds. Routed through the platform-aware
// `credentials` abstraction (sessionStorage / safeStorage / Preferences) — the
// key is NEVER written into settings/localStorage in plaintext.
// ============================================================================

import { credentials } from './credentials';

const DOC_SCAN_KEY = 'doc_scan_key';

/** The single list of credential keys, for boot-priming + full teardown. */
export const CREDENTIAL_STORE_KEYS = [DOC_SCAN_KEY] as const;

export function getDocScanKey(): string {
  return credentials.get(DOC_SCAN_KEY);
}

export function setDocScanKey(key: string): void {
  credentials.set(DOC_SCAN_KEY, key);
}

export function clearDocScanKey(): void {
  credentials.remove(DOC_SCAN_KEY);
}

/** Wipe every stored secret (device reset). */
export function clearAllCredentials(): void {
  for (const key of CREDENTIAL_STORE_KEYS) credentials.remove(key);
}
