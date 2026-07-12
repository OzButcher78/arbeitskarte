// ============================================================================
// ELECTRON IPC: minimal local filesystem (channels: fs:pickDirectory,
// fs:saveFile, fs:revealPath, fs:readFile)
// ----------------------------------------------------------------------------
// Small, self-contained surface for exporting a rendered card PDF to disk and
// revealing it. No vault/sync machinery — the Arbeitskarte archive lives in
// IndexedDB (Dexie), not on the filesystem.
// ============================================================================

import { app, BrowserWindow, dialog, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { jsonResult, type IpcResult } from './types';

function activeWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
}

export async function pickDirectoryIpc(): Promise<IpcResult> {
  const win = activeWindow();
  const res = win
    ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return jsonResult(200, { canceled: true });
  return jsonResult(200, { canceled: false, path: res.filePaths[0] });
}

export type SaveFileArgs = {
  /** Suggested filename in the Save dialog, e.g. "Arbeitskarte-001.pdf". */
  defaultName?: string;
  /** File contents. */
  base64?: string;
  text?: string;
  /** Dialog filter label + extensions, e.g. { name: 'PDF', extensions: ['pdf'] }. */
  filter?: { name: string; extensions: string[] };
};

export async function saveFileIpc(args: SaveFileArgs): Promise<IpcResult> {
  if (!args || (args.base64 == null && args.text == null)) {
    return jsonResult(400, { error: 'Kein Dateiinhalt übergeben.' });
  }
  const win = activeWindow();
  const filters = args.filter ? [args.filter] : undefined;
  const res = win
    ? await dialog.showSaveDialog(win, { defaultPath: args.defaultName, filters })
    : await dialog.showSaveDialog({ defaultPath: args.defaultName, filters });
  if (res.canceled || !res.filePath) return jsonResult(200, { canceled: true });
  try {
    if (args.base64 != null) {
      await fs.writeFile(res.filePath, Buffer.from(args.base64, 'base64'));
    } else {
      await fs.writeFile(res.filePath, args.text ?? '', 'utf-8');
    }
    return jsonResult(200, { canceled: false, path: res.filePath });
  } catch (err: any) {
    return jsonResult(500, { error: 'Speichern fehlgeschlagen: ' + (err?.message || err) });
  }
}

export async function revealPathIpc(args: { path: string }): Promise<IpcResult> {
  if (!args?.path) return jsonResult(400, { error: 'Kein Pfad übergeben.' });
  try {
    shell.showItemInFolder(args.path);
    return jsonResult(200, { success: true });
  } catch (err: any) {
    return jsonResult(500, { error: String(err?.message || err) });
  }
}

export type WriteFileToPathArgs = {
  /** Absolute destination path. Parent directories are created as needed. */
  path?: string;
  base64?: string;
  text?: string;
};

/** Silent write to an explicit path (no Save dialog) — used by the auto-backup.
 *  Mirrors saveFileIpc minus the picker; creates the parent folder first. */
export async function writeFileToPathIpc(args: WriteFileToPathArgs): Promise<IpcResult> {
  if (!args?.path) return jsonResult(400, { error: 'Kein Pfad übergeben.' });
  if (args.base64 == null && args.text == null) {
    return jsonResult(400, { error: 'Kein Dateiinhalt übergeben.' });
  }
  try {
    await fs.mkdir(path.dirname(args.path), { recursive: true });
    if (args.base64 != null) {
      await fs.writeFile(args.path, Buffer.from(args.base64, 'base64'));
    } else {
      await fs.writeFile(args.path, args.text ?? '', 'utf-8');
    }
    return jsonResult(200, { success: true, path: args.path });
  } catch (err: any) {
    return jsonResult(500, { error: 'Speichern fehlgeschlagen: ' + (err?.message || err) });
  }
}

export async function readFileIpc(args: { path: string; encoding?: 'base64' | 'text' }): Promise<IpcResult> {
  if (!args?.path) return jsonResult(400, { error: 'Kein Pfad übergeben.' });
  try {
    const buf = await fs.readFile(args.path);
    if (args.encoding === 'text') {
      return jsonResult(200, { content: buf.toString('utf-8') });
    }
    return jsonResult(200, { content: buf.toString('base64') });
  } catch (err: any) {
    return jsonResult(500, { error: String(err?.message || err) });
  }
}
