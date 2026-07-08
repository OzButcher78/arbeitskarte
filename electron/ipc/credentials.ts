// ============================================================================
// ELECTRON IPC: OS-backed credential store (safeStorage)
// ----------------------------------------------------------------------------
// Encrypted file in userData. On Windows this uses DPAPI — credentials are
// bound to the current user account and encrypted at rest. Used here for the
// bring-your-own scanner API key (doc_scan_key), never stored in plaintext
// settings.
// ============================================================================

// [ANDROID-PORT] Electron's safeStorage (DPAPI on Windows) has an Android
//   equivalent: EncryptedSharedPreferences / Keystore. The Capacitor twin in
//   src/platform/credentials.ts wraps @capacitor/preferences behind the same
//   async get/set API.
import { app, safeStorage } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { jsonResult, type IpcResult } from './types';

function credsPath(): string {
  return path.join(app.getPath('userData'), 'credentials.enc');
}

let cache: Record<string, string> | null = null;

async function loadCreds(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const buf = await fs.readFile(credsPath());
    if (!safeStorage.isEncryptionAvailable()) {
      cache = JSON.parse(buf.toString('utf-8'));
      return cache!;
    }
    const decrypted = safeStorage.decryptString(buf);
    cache = JSON.parse(decrypted);
    return cache!;
  } catch {
    cache = {};
    return cache;
  }
}

async function writeCreds(next: Record<string, string>): Promise<void> {
  cache = next;
  const json = JSON.stringify(next);
  if (!safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(credsPath(), json, 'utf-8');
    return;
  }
  const enc = safeStorage.encryptString(json);
  await fs.writeFile(credsPath(), enc);
}

export async function credGetIpc(args: { key: string }): Promise<IpcResult> {
  const creds = await loadCreds();
  return jsonResult(200, { value: creds[args.key] ?? '' });
}

export async function credSetIpc(args: { key: string; value: string }): Promise<IpcResult> {
  const creds = await loadCreds();
  if (args.value) {
    creds[args.key] = args.value;
  } else {
    delete creds[args.key];
  }
  await writeCreds(creds);
  return jsonResult(200, { success: true });
}

export async function credRemoveIpc(args: { key: string }): Promise<IpcResult> {
  const creds = await loadCreds();
  if (args.key in creds) {
    delete creds[args.key];
    await writeCreds(creds);
  }
  return jsonResult(200, { success: true });
}

export async function credClearPrefixIpc(args: { prefix: string }): Promise<IpcResult> {
  const creds = await loadCreds();
  let changed = false;
  for (const k of Object.keys(creds)) {
    if (k.startsWith(args.prefix)) {
      delete creds[k];
      changed = true;
    }
  }
  if (changed) await writeCreds(creds);
  return jsonResult(200, { success: true });
}

// ----------------------------------------------------------------------------
// Synchronous initial-load helper — called from preload via ipcRenderer.sendSync
// so the renderer has credentials available on the *first* synchronous read.
// ----------------------------------------------------------------------------
export function loadCredsSync(): Record<string, string> {
  if (cache) return cache;
  try {
    const buf = readFileSync(credsPath());
    if (!safeStorage.isEncryptionAvailable()) {
      cache = JSON.parse(buf.toString('utf-8'));
      return cache!;
    }
    const decrypted = safeStorage.decryptString(buf);
    cache = JSON.parse(decrypted);
    return cache!;
  } catch {
    cache = {};
    return cache;
  }
}
