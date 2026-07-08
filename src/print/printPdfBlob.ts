// ============================================================================
// Print router — HTML → PDF bytes → preview/print. Platform-agnostic call site.
//   • Electron: printToPdf (offscreen printToPDF) + printPdf (native preview).
//   • Android (Phase 4): render into a WebView and invoke system print.
//   • Browser (dev): open the PDF blob in a new tab as a fallback.
// ============================================================================

import { isElectron } from '../platform/detect';

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
