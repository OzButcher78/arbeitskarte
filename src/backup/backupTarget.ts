// ============================================================================
// backupTarget — platform-split write of a backup JSON string.
// ----------------------------------------------------------------------------
//   • Electron → silent write to <dir>/backups/<file> via the fs:writeFileToPath IPC.
//   • Android  → Filesystem.writeFile into Documents/Arbeitskarte/backups (app-scoped,
//                needs no storage permission; the manifest stays INTERNET-only).
//   • Browser  → <a download> of the JSON blob (dev fallback).
// Mirrors the platform seam used by printPdfBlob.ts / credentials.ts.
// ============================================================================

import { isElectron, isAndroid } from '../platform/detect';

export type WriteMethod = 'electron' | 'android' | 'download';

export interface WriteResult {
  ok: boolean;
  method: WriteMethod;
  /** Where it was written (Electron absolute path / Android relative path). */
  path?: string;
  error?: string;
}

function ipcError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error?: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return fallback;
}

/** Strip a trailing slash/backslash so `${dir}/backups` never doubles up. */
function trimSep(dir: string): string {
  return dir.replace(/[\\/]+$/, '');
}

export async function writeBackup(json: string, fileName: string, dir?: string): Promise<WriteResult> {
  if (isElectron() && window.electronAPI) {
    if (!dir) return { ok: false, method: 'electron', error: 'Kein Sicherungsordner gewählt.' };
    const path = `${trimSep(dir)}/backups/${fileName}`;
    try {
      const res = await window.electronAPI.fs.writeFileToPath({ path, text: json });
      if (res.status === 200) return { ok: true, method: 'electron', path };
      return { ok: false, method: 'electron', error: ipcError(res.body, 'Sicherung fehlgeschlagen.') };
    } catch (e) {
      // A rejected invoke (e.g. the fs:writeFileToPath handler isn't registered
      // because the desktop app was not restarted after the update).
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        method: 'electron',
        error: /No handler registered|writeFileToPath/i.test(msg)
          ? 'Sicherung fehlgeschlagen: Bitte die Desktop-App neu starten (Update erfordert Neustart).'
          : `Sicherung fehlgeschlagen: ${msg}`,
      };
    }
  }

  if (isAndroid()) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const relPath = `Arbeitskarte/backups/${fileName}`;
      await Filesystem.writeFile({
        path: relPath,
        data: json,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return { ok: true, method: 'android', path: `Documents/${relPath}` };
    } catch (e) {
      return { ok: false, method: 'android', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Browser fallback — hand the file to the download manager.
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, method: 'download' };
  } catch (e) {
    return { ok: false, method: 'download', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Electron folder picker (returns the chosen absolute path); no-op elsewhere. */
export async function pickBackupDir(): Promise<string | null> {
  if (isElectron() && window.electronAPI) {
    const res = await window.electronAPI.fs.pickDirectory();
    const body = res.body as { canceled?: boolean; path?: string } | undefined;
    if (res.status === 200 && body && !body.canceled && body.path) return body.path;
  }
  return null;
}

/** Reveal the backups folder in Explorer (Electron only; best-effort). */
export async function revealBackupFolder(dir?: string): Promise<void> {
  if (isElectron() && window.electronAPI && dir) {
    await window.electronAPI.fs.revealPath({ path: `${trimSep(dir)}/backups` });
  }
}
