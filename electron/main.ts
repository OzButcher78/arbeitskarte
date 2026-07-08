// ============================================================================
// Arbeitskarte — Electron main process
// ----------------------------------------------------------------------------
// Native-feeling desktop shell: no menu bar, hidden title bar with Windows 11
// overlay controls, no startup flash, persistent window size/position,
// single-instance lock. IPC surface: PDF render/preview, minimal FS, encrypted
// credential store, and (Phase 1) the document scanner.
// ============================================================================

import { app, BrowserWindow, Menu, ipcMain, shell, session } from 'electron';
import path from 'node:path';

// Pin the userData folder to 'Arbeitskarte' (IndexedDB, localStorage,
// credentials.enc all derive from app.getPath('userData')). Must run before
// any getPath('userData') call and before app.whenReady().
app.setPath('userData', path.join(app.getPath('appData'), 'Arbeitskarte'));

import { printPdfIpc } from './ipc/print';
import { printToPdfIpc } from './ipc/printPdf';
import {
  pickDirectoryIpc,
  saveFileIpc,
  revealPathIpc,
  readFileIpc,
} from './ipc/fs';
import {
  credGetIpc,
  credSetIpc,
  credRemoveIpc,
  credClearPrefixIpc,
  loadCredsSync,
} from './ipc/credentials';

// Surface any silent main-process crash — without this, errors here produce a
// hung-but-invisible Electron process that's impossible to debug.
process.on('uncaughtException', (err) => {
  console.error('[electron:main] UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[electron:main] UNHANDLED REJECTION:', reason);
});

// electron-window-state is CJS; loaded lazily so a failure here is logged, not
// fatal — we fall back to unmanaged defaults.
let windowStateKeeper: typeof import('electron-window-state') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  windowStateKeeper = require('electron-window-state');
} catch (err) {
  console.error('[electron:main] electron-window-state unavailable:', err);
}

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const APP_ID = 'ch.spritzwerkgrab.arbeitskarte';
const APP_BG = '#ffffff';
const TITLEBAR_SYMBOL = '#475569';

// Nuke the default Electron menu app-wide. Must happen before any window.
Menu.setApplicationMenu(null);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

// Single-instance lock — second launch just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function registerIpcHandlers(): void {
  ipcMain.handle('pdf:printToPdf', (_event, args) => printToPdfIpc(args));
  ipcMain.handle('pdf:print', (_event, args) => printPdfIpc(args));

  ipcMain.handle('fs:pickDirectory', () => pickDirectoryIpc());
  ipcMain.handle('fs:saveFile', (_event, args) => saveFileIpc(args));
  ipcMain.handle('fs:revealPath', (_event, args) => revealPathIpc(args));
  ipcMain.handle('fs:readFile', (_event, args) => readFileIpc(args));

  ipcMain.handle('cred:get', (_event, args) => credGetIpc(args));
  ipcMain.handle('cred:set', (_event, args) => credSetIpc(args));
  ipcMain.handle('cred:remove', (_event, args) => credRemoveIpc(args));
  ipcMain.handle('cred:clearPrefix', (_event, args) => credClearPrefixIpc(args));

  // Synchronous channel for preload startup — decrypts the credentials file
  // once so the renderer's first synchronous read returns the real value.
  ipcMain.on('cred:initialSync', (event) => {
    try {
      event.returnValue = loadCredsSync();
    } catch (err) {
      console.error('[electron:main] cred:initialSync failed:', err);
      event.returnValue = {};
    }
  });

  // App version — synchronous so the UI can render the build number on first paint.
  ipcMain.on('app:getVersionSync', (event) => {
    try {
      event.returnValue = app.getVersion();
    } catch {
      event.returnValue = '0.0.0';
    }
  });

  // Open DevTools on demand (dev only; packaged builds disable DevTools).
  ipcMain.handle('app:openDevTools', () => {
    if (app.isPackaged) return { ok: false };
    try {
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      }
      return { ok: true };
    } catch (err) {
      console.error('[electron:main] openDevTools failed:', err);
      return { ok: false };
    }
  });
}

function createWindow(): void {
  let windowState: import('electron-window-state').State | null = null;
  if (windowStateKeeper) {
    try {
      windowState = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 880 });
    } catch (err) {
      console.error('[electron:main] windowStateKeeper init failed:', err);
    }
  }

  mainWindow = new BrowserWindow({
    x: windowState?.x,
    y: windowState?.y,
    width: windowState?.width ?? 1280,
    height: windowState?.height ?? 880,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: APP_BG,
    autoHideMenuBar: true,
    title: 'Arbeitskarte',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: APP_BG,
      symbolColor: TITLEBAR_SYMBOL,
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  if (windowState) windowState.manage(mainWindow);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[electron:main] did-fail-load (${code}): ${desc} @ ${url}`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error(`[electron:main] preload-error in ${preloadPath}:`, err);
  });

  // Open external links in the OS browser, never inside the Electron window.
  // Allow blob: URLs (PDF previews) to open in a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    if (/^blob:/i.test(url)) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  // Block browser-ish shortcuts in production (reload, view-source, zoom,
  // DevTools openers, the browser print dialog — we have our own PDF flow).
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase();
      const ctrlOrCmd = input.control || input.meta;
      if (input.key === 'F12' || (ctrlOrCmd && input.shift && (key === 'i' || key === 'j' || key === 'c'))) {
        event.preventDefault();
        return;
      }
      if ((ctrlOrCmd && key === 'r') || input.key === 'F5') { event.preventDefault(); return; }
      if (ctrlOrCmd && key === 'u') { event.preventDefault(); return; }
      if (ctrlOrCmd && key === 'p') { event.preventDefault(); return; }
      if (ctrlOrCmd && (key === '=' || key === '+' || key === '-' || key === '0')) { event.preventDefault(); return; }
    });
  }

  // Editing accelerators (Ctrl/Cmd + C/X/V/A/Z/Y). Menu.setApplicationMenu(null)
  // silently disables the default clipboard accelerators in text fields, so
  // re-bind them directly on the focused WebContents.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod || input.alt) return;
    const wc = mainWindow?.webContents;
    if (!wc) return;
    switch (input.key.toLowerCase()) {
      case 'c': wc.copy(); break;
      case 'x': wc.cut(); break;
      case 'v': wc.paste(); break;
      case 'a': wc.selectAll(); break;
      case 'z': if (input.shift) wc.redo(); else wc.undo(); break;
      case 'y': wc.redo(); break;
      default: return;
    }
    event.preventDefault();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] Renderer process gone:', details.reason, details.exitCode);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  // Auto-grant the `media` permission so the in-app camera modal can open the
  // device camera without a system dialog. Granted only to our own renderer.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
