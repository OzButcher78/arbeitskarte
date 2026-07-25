export {};

declare global {
  /** Injected by vite.config.ts `define` from package.json version. */
  const __APP_VERSION__: string;

  interface IpcResult {
    status: number;
    headers?: Record<string, string>;
    body: Uint8Array | unknown;
  }

  interface ArbeitskarteElectronAPI {
    isElectron: true;
    platform: string;
    version: string;
    appVersion: string;
    initialCredentials: Record<string, string>;
    printToPdf(args: { html: string; filename?: string }): Promise<IpcResult>;
    printPdf(args: { pdfBytes: Uint8Array; title?: string }): Promise<IpcResult>;
    scanDocument(args: unknown): Promise<IpcResult>;
    listScanModels(args: unknown): Promise<IpcResult>;
    companion: {
      start(): Promise<IpcResult>;
      poll(token: string): Promise<IpcResult>;
      stop(): Promise<IpcResult>;
    };
    fs: {
      pickDirectory(): Promise<IpcResult>;
      saveFile(args: unknown): Promise<IpcResult>;
      revealPath(args: { path: string }): Promise<IpcResult>;
      readFile(args: { path: string; encoding?: 'base64' | 'text' }): Promise<IpcResult>;
      writeFileToPath(args: { path: string; base64?: string; text?: string }): Promise<IpcResult>;
    };
    cred: {
      get(key: string): Promise<IpcResult>;
      set(key: string, value: string): Promise<IpcResult>;
      remove(key: string): Promise<IpcResult>;
      clearPrefix(prefix: string): Promise<IpcResult>;
    };
  }

  interface Window {
    electronAPI?: ArbeitskarteElectronAPI;
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}
