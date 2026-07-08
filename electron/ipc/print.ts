// ============================================================================
// ELECTRON IPC: print-preview window for a PDF Blob  (channel: pdf:print)
// ----------------------------------------------------------------------------
// Opens the generated PDF in a visible BrowserWindow using Chromium's built-in
// PDF viewer. Its toolbar gives zoom, page navigation and a Print button that
// opens the OS print dialog (where "Als PDF speichern" and page-range work).
// Routing through a real PDF window also avoids the Chromium iframe-print bug
// where Save-as-PDF produces blank output.
// ============================================================================

import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { jsonResult, type IpcResult } from './types';

export type PrintPdfArgs = {
  /** Raw PDF bytes (transferred over IPC as Uint8Array). */
  pdfBytes: Uint8Array;
  /** Optional title shown in the print dialog window. */
  title?: string;
};

export async function printPdfIpc(args: PrintPdfArgs): Promise<IpcResult> {
  if (!args?.pdfBytes || args.pdfBytes.byteLength === 0) {
    return jsonResult(400, { error: 'Keine PDF-Daten erhalten' });
  }

  // Write to a unique temp file so concurrent prints don't clash.
  const tmpDir = app.getPath('temp');
  const tmpFile = path.join(tmpDir, `arbeitskarte-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  try {
    await fs.writeFile(tmpFile, Buffer.from(args.pdfBytes));
  } catch (err: any) {
    return jsonResult(500, { error: 'Temp-Datei konnte nicht geschrieben werden: ' + (err?.message || err) });
  }

  const cleanup = () => { fs.unlink(tmpFile).catch(() => {}); };

  const baseTitle = (args.title || 'Dokument').replace(/\.pdf$/i, '');
  const previewWin = new BrowserWindow({
    show: false,
    width: 1000,
    height: 900,
    title: `Druckvorschau — ${baseTitle}`,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  previewWin.once('ready-to-show', () => {
    if (!previewWin.isDestroyed()) previewWin.show();
  });
  previewWin.once('closed', cleanup);

  try {
    await previewWin.loadFile(tmpFile);
  } catch (err: any) {
    cleanup();
    if (!previewWin.isDestroyed()) previewWin.close();
    return jsonResult(500, { error: 'PDF konnte nicht geladen werden: ' + (err?.message || err) });
  }

  return jsonResult(200, { success: true });
}
