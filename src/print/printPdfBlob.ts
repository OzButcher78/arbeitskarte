// ============================================================================
// Print router — HTML → PDF bytes → preview/print. Platform-agnostic call site.
//   • Electron: printToPdf (offscreen printToPDF) + printPdf (native preview).
//   • Android: native PrinterPlugin (Android Print Framework) → system print
//     dialog. The WebView's own window.print() is a no-op, so we must go native.
//   • Browser (dev): render the HTML in an offscreen iframe and invoke print()
//     on it — the dialog is the whole UI, no extra tab/window appears.
// ============================================================================

import { isElectron } from '../platform/detect';
import { canNativePrint, nativePrintHtml } from '../platform/androidPrint';

function ipcError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error?: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return fallback;
}

/** Render self-contained HTML (inline CSS + inline base64 images) to PDF bytes. */
export async function renderHtmlToPdfBytes(html: string, filename?: string): Promise<Uint8Array> {
  if (isElectron() && window.electronAPI) {
    const res = await window.electronAPI.printToPdf({ html, filename });
    if (res.status === 200 && res.body instanceof Uint8Array) return res.body;
    throw new Error(ipcError(res.body, 'PDF-Erzeugung fehlgeschlagen.'));
  }
  throw new Error('PDF-Erzeugung ist nur in der Desktop-App verfügbar.');
}

/** Show PDF bytes in a native preview window (Electron) or a new tab (browser). */
export async function previewPdfBytes(bytes: Uint8Array, title?: string): Promise<void> {
  if (isElectron() && window.electronAPI) {
    const res = await window.electronAPI.printPdf({ pdfBytes: bytes, title });
    if (res.status !== 200) throw new Error(ipcError(res.body, 'Vorschau fehlgeschlagen.'));
    return;
  }
  // Copy into a fresh ArrayBuffer so the Blob owns contiguous bytes.
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoke after a beat so the new tab has time to load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Browser fallback: print self-contained HTML from an OFFSCREEN iframe.
 *
 * This used to `window.open()` a visible tab, write the card into it and then
 * call print() — which left the user staring at a full-screen copy of the A4
 * layout behind the print dialog, and a stray tab to close afterwards. An iframe
 * gives the same print output with nothing on screen but the dialog itself.
 *
 * `srcdoc` keeps the frame same-origin, so contentWindow.print() is allowed. The
 * frame is torn down on `afterprint`, with a long timer as a backstop for
 * browsers that don't fire it.
 */
function printViaHiddenFrame(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    // Not display:none — several engines refuse to print a frame that isn't laid
    // out. Zero-sized and clipped is the reliable way to hide it.
    frame.style.cssText =
      'position:fixed;left:-9999px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;';

    let settled = false;
    let fallbackTimer = 0;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      frame.remove();
      resolve();
    };

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new Error('Die Druckvorschau konnte nicht geöffnet werden.'));
        return;
      }
      win.addEventListener('afterprint', cleanup, { once: true });
      try {
        win.focus();
        win.print();
      } catch {
        frame.remove();
        settled = true;
        reject(new Error('Die Druckvorschau konnte nicht geöffnet werden.'));
        return;
      }
      // print() blocks until the dialog closes in most engines, so afterprint has
      // usually already fired by here. Keep the frame alive for a while for the
      // ones where it doesn't — removing it early cancels the job.
      fallbackTimer = window.setTimeout(cleanup, 60_000);
    };

    document.body.appendChild(frame);
    frame.srcdoc = html;
  });
}

export async function printJobCard(html: string, filename: string): Promise<void> {
  if (isElectron() && window.electronAPI) {
    const bytes = await renderHtmlToPdfBytes(html, filename);
    await previewPdfBytes(bytes, filename);
    return;
  }
  if (canNativePrint()) {
    // Android: hand the HTML to the system print dialog (no trap window).
    await nativePrintHtml(html, filename.replace(/\.pdf$/i, ''));
    return;
  }
  await printViaHiddenFrame(html);
}

/**
 * Preview a self-contained job-card HTML page as a print preview.
 *   • Electron: render → PDF bytes → native preview window (Chromium PDF viewer
 *     with its own Drucken / Als PDF speichern buttons).
 *   • Android / browser: open the page and invoke the system print dialog, which
 *     shows the OS/browser print preview (and offers "Als PDF speichern"). No PDF
 *     engine is bundled, so this is the browser's own print preview.
 */
export async function previewJobCard(html: string, filename: string): Promise<void> {
  if (isElectron() && window.electronAPI) {
    const bytes = await renderHtmlToPdfBytes(html, filename);
    await previewPdfBytes(bytes, filename);
    return;
  }
  if (canNativePrint()) {
    // Android: the system print dialog IS the preview (shows the A4 layout).
    await nativePrintHtml(html, filename.replace(/\.pdf$/i, ''));
    return;
  }
  // The browser's print dialog is itself the preview — showing the page behind
  // it as well was just a window to close afterwards.
  await printViaHiddenFrame(html);
}
