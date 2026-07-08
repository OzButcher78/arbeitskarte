// ============================================================================
// CREDENTIAL STORAGE ABSTRACTION
// ----------------------------------------------------------------------------
// Browser:  sessionStorage (per-tab, never persisted to disk).
// Electron: OS-backed encrypted file via safeStorage (DPAPI on Windows), over
//           IPC. The preload snapshot (window.electronAPI.initialCredentials)
//           primes the cache so the first synchronous get() returns the real
//           value.
// Android:  @capacitor/preferences. The scanner BYO key is the only secret this
//           app stores; if a hardened EncryptedSharedPreferences store is added
//           later, swap the Android branch behind this same interface.
//
// Callers see a synchronous get(key) → string. The cache is primed once at boot;
// subsequent get/set hit the cache and write through.
// ============================================================================

import { isAndroid, isElectron } from './detect';

export interface ICredentialStore {
  get(key: string): string;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
}

const PREFIX = 'ak_';

// ── Browser (sessionStorage) ────────────────────────────────────────────────

function createBrowserCredentialStore(prefix: string): ICredentialStore {
  return {
    get(key) {
      return sessionStorage.getItem(`${prefix}${key}`) || '';
    },
    set(key, value) {
      if (value) sessionStorage.setItem(`${prefix}${key}`, value);
      else sessionStorage.removeItem(`${prefix}${key}`);
    },
    remove(key) {
      sessionStorage.removeItem(`${prefix}${key}`);
    },
    clear() {
      const toRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) toRemove.push(k);
      }
      toRemove.forEach((k) => sessionStorage.removeItem(k));
    },
  };
}

// ── Electron (safeStorage via IPC + write-through cache) ─────────────────────

const electronCache: Record<string, string> = {};

if (isElectron()) {
  const initial = window.electronAPI?.initialCredentials;
  if (initial && typeof initial === 'object') Object.assign(electronCache, initial);
}

function createElectronCredentialStore(prefix: string): ICredentialStore {
  const keyOf = (k: string) => `${prefix}${k}`;
  const api = () => window.electronAPI?.cred ?? null;
  return {
    get(key) {
      const fullKey = keyOf(key);
      if (fullKey in electronCache) return electronCache[fullKey];
      // Background fill so a later read hits the cache; returns '' meanwhile.
      const cred = api();
      if (cred) {
        void cred.get(fullKey).then((res) => {
          const v = (res.body as { value?: string } | undefined)?.value ?? '';
          if (!(fullKey in electronCache)) electronCache[fullKey] = v;
        });
      }
      return '';
    },
    set(key, value) {
      const fullKey = keyOf(key);
      electronCache[fullKey] = value;
      void api()?.set(fullKey, value).catch((err) => console.error('[credentials] set failed:', err));
    },
    remove(key) {
      const fullKey = keyOf(key);
      delete electronCache[fullKey];
      void api()?.remove(fullKey).catch((err) => console.error('[credentials] remove failed:', err));
    },
    clear() {
      for (const k of Object.keys(electronCache)) if (k.startsWith(prefix)) delete electronCache[k];
      void api()?.clearPrefix(prefix).catch((err) => console.error('[credentials] clear failed:', err));
    },
  };
}

// ── Android (@capacitor/preferences + write-through cache) ───────────────────

const capacitorCache: Record<string, string> = {};

async function capacitorGet(fullKey: string): Promise<string> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const res = await Preferences.get({ key: fullKey });
    return res.value ?? '';
  } catch {
    return '';
  }
}

function createCapacitorCredentialStore(prefix: string): ICredentialStore {
  const keyOf = (k: string) => `${prefix}${k}`;
  return {
    get(key) {
      const fullKey = keyOf(key);
      if (fullKey in capacitorCache) return capacitorCache[fullKey];
      void capacitorGet(fullKey).then((v) => {
        if (!(fullKey in capacitorCache)) capacitorCache[fullKey] = v;
      });
      return '';
    },
    set(key, value) {
      const fullKey = keyOf(key);
      capacitorCache[fullKey] = value;
      void import('@capacitor/preferences')
        .then(({ Preferences }) =>
          value ? Preferences.set({ key: fullKey, value }) : Preferences.remove({ key: fullKey }),
        )
        .catch((err) => console.error('[credentials:android] set failed:', err));
    },
    remove(key) {
      const fullKey = keyOf(key);
      delete capacitorCache[fullKey];
      void import('@capacitor/preferences')
        .then(({ Preferences }) => Preferences.remove({ key: fullKey }))
        .catch((err) => console.error('[credentials:android] remove failed:', err));
    },
    clear() {
      for (const k of Object.keys(capacitorCache)) if (k.startsWith(prefix)) delete capacitorCache[k];
      void import('@capacitor/preferences')
        .then(({ Preferences }) =>
          Preferences.keys().then(({ keys }) =>
            Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => Preferences.remove({ key: k }))),
          ),
        )
        .catch(() => {});
    },
  };
}

// ── Public API — auto-selects per platform ───────────────────────────────────

export const credentials: ICredentialStore = isAndroid()
  ? createCapacitorCredentialStore(PREFIX)
  : isElectron()
    ? createElectronCredentialStore(PREFIX)
    : createBrowserCredentialStore(PREFIX);

/** Warm the Capacitor credential cache. Call on boot for keys the UI reads
 *  synchronously. No-op outside Android. */
export async function primeCapacitorCredentials(keys: readonly string[]): Promise<void> {
  if (!isAndroid()) return;
  await Promise.all(
    keys.map(async (k) => {
      const fullKey = `${PREFIX}${k}`;
      if (fullKey in capacitorCache) return;
      capacitorCache[fullKey] = await capacitorGet(fullKey);
    }),
  );
}
