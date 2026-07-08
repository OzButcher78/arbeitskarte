// ============================================================================
// ELECTRON IPC: HTML → PDF via webContents.printToPDF  (channel: pdf:printToPdf)
// ----------------------------------------------------------------------------
// Replaces the Puppeteer/@sparticuz/chromium server render used elsewhere. An
// offscreen BrowserWindow loads the card HTML from a temp file (data: URLs hit
// a size cap once photos are inlined), calls printToPDF at A4, and returns the
// bytes. The caller previews them via pdf:print or saves via fs:saveFile.
// ============================================================================

import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { jsonResult, type IpcResult } from './types';

export type PrintToPdfArgs = {
  /** Fully self-contained HTML (inline CSS + inline base64 images). */
  html: string;
  /** Optional filename hint (unused by the render, echoed for convenience). */
  filename?: string;
};

export async function printToPdfIpc(args: PrintToPdfArgs): Promise<IpcResult> {
  const html = args?.html;
  if (!html || typeof html !== 'string') {
    return jsonResult(400, { error: 'Kein HTML erhalten' });
  }

  const tmpDir = app.getPath('temp');
  const tmpFile = path.join(tmpDir, `arbeitskarte-render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // No preload here — this is a throwaway render surface, not the app.
    },
  });

  const cleanup = () => { fs.unlink(tmpFile).catch(() => {}); };

  try {
    await fs.writeFile(tmpFile, html, 'utf-8');
    await win.loadFile(tmpFile);
    // loadFile resolves on did-finish-load; give layout/fonts a beat to settle.
    await new Promise((r) => setTimeout(r, 50));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(pdf),
    };
  } catch (err: any) {
    return jsonResult(500, { error: 'PDF-Erzeugung fehlgeschlagen: ' + (err?.message || err) });
  } finally {
    cleanup();
    if (!win.isDestroyed()) win.destroy();
  }
}
