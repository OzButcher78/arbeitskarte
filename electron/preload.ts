import { contextBridge, ipcRenderer } from 'electron';

type IpcResult = {
  status: number;
  headers?: Record<string, string>;
  body: Uint8Array | unknown;
};

// Pre-fetch the encrypted credential store synchronously at preload time so
// the renderer's first `credentials.get(...)` call returns the real value.
let initialCredentials: Record<string, string> = {};
try {
  const result = ipcRenderer.sendSync('cred:initialSync');
  if (result && typeof result === 'object') initialCredentials = result;
} catch (err) {
  console.error('[preload] cred:initialSync failed:', err);
}

// Read the packaged app version synchronously so the UI has it on first paint.
let appVersion = '0.0.0';
try {
  const v = ipcRenderer.sendSync('app:getVersionSync');
  if (typeof v === 'string') appVersion = v;
} catch (err) {
  console.error('[preload] app:getVersionSync failed:', err);
}

const api = {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,
  appVersion,
  initialCredentials,

  // ── PDF ────────────────────────────────────────────────────────────────
  /** Render self-contained HTML → PDF bytes via printToPDF in the main proc. */
  printToPdf: (args: { html: string; filename?: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('pdf:printToPdf', args),
  /** Open PDF bytes in a native preview window with a Print / Save-as-PDF button. */
  printPdf: (args: { pdfBytes: Uint8Array; title?: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('pdf:print', args),

  // ── Vehicle Document Scanner (Phase 1) ───────────────────────────────────
  // bridgeFetch('/api/scan-document') routes here → main-process fetch straight
  // to the chosen OCR provider (image + BYO key never touch third-party infra).
  scanDocument: (args: unknown): Promise<IpcResult> =>
    ipcRenderer.invoke('scan:document', args),

  // ── Local filesystem ─────────────────────────────────────────────────────
  fs: {
    pickDirectory: (): Promise<IpcResult> => ipcRenderer.invoke('fs:pickDirectory'),
    saveFile: (args: unknown): Promise<IpcResult> => ipcRenderer.invoke('fs:saveFile', args),
    revealPath: (args: { path: string }): Promise<IpcResult> => ipcRenderer.invoke('fs:revealPath', args),
    readFile: (args: { path: string; encoding?: 'base64' | 'text' }): Promise<IpcResult> =>
      ipcRenderer.invoke('fs:readFile', args),
  },

  // ── Encrypted credential store (safeStorage / DPAPI on Windows) ───────────
  cred: {
    get: (key: string): Promise<IpcResult> => ipcRenderer.invoke('cred:get', { key }),
    set: (key: string, value: string): Promise<IpcResult> => ipcRenderer.invoke('cred:set', { key, value }),
    remove: (key: string): Promise<IpcResult> => ipcRenderer.invoke('cred:remove', { key }),
    clearPrefix: (prefix: string): Promise<IpcResult> => ipcRenderer.invoke('cred:clearPrefix', { prefix }),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

// ----------------------------------------------------------------------------
// Native-feel drag zone injection
// ----------------------------------------------------------------------------
// titleBarStyle:'hidden' + titleBarOverlay removes the default drag region, so
// without this the window can't be moved. We inject 36px top padding + a
// full-width drag strip ending 140px before the right edge (room for the
// min/max/close overlay), plus a belt-and-braces no-drag rule on interactive
// elements.
// ----------------------------------------------------------------------------

const DRAG_ZONE_STYLE = `
  body {
    padding-top: 36px !important;
    box-sizing: border-box;
  }
  #__arbeitskarte_drag_strip {
    position: fixed;
    top: 0;
    left: 0;
    right: 140px;
    height: 36px;
    -webkit-app-region: drag;
    z-index: 2147483647;
    background: transparent;
  }
  button, a, input, select, textarea, label, summary,
  [role="button"], [role="tab"], [role="menuitem"], [tabindex] {
    -webkit-app-region: no-drag;
  }
`;

function injectDragZone(): void {
  if (document.getElementById('__arbeitskarte_drag_zone_style')) return;

  const style = document.createElement('style');
  style.id = '__arbeitskarte_drag_zone_style';
  style.textContent = DRAG_ZONE_STYLE;
  document.head.appendChild(style);

  const strip = document.createElement('div');
  strip.id = '__arbeitskarte_drag_strip';
  document.body.appendChild(strip);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  injectDragZone();
} else {
  window.addEventListener('DOMContentLoaded', injectDragZone, { once: true });
}
