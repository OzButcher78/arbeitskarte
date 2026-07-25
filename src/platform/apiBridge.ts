// ============================================================================
// API BRIDGE — the single seam for the document-scanner network call.
// ----------------------------------------------------------------------------
// bridgeFetch('/api/scan-document') routes to:
//   • Electron: the main-process IPC handler (window.electronAPI.scanDocument),
//     which POSTs straight to the chosen OCR provider (avoids renderer CORS).
//   • Android: CapacitorHttp (native request, bypasses the WebView CORS layer).
//   • Browser (dev): 501 — the scanner needs a native transport.
// The image + BYO key leave the device only towards the provider the user chose.
// There is NO server endpoint behind '/api/scan-document' — it's a routing key.
// ============================================================================

import { isAndroid, isElectron } from './detect';
import {
  buildScanRequest,
  buildModelsRequest,
  coerceScanProvider,
  type ScanProvider,
  type ScanKind,
} from '../scan/scanProviders';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function parseInit<T = Record<string, unknown>>(init?: RequestInit): T {
  if (!init?.body || typeof init.body !== 'string') return {} as T;
  try {
    return JSON.parse(init.body) as T;
  } catch {
    return {} as T;
  }
}

export async function bridgeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === '/api/scan-document') {
    if (isAndroid()) return androidScanDocument(init);
    if (isElectron()) return electronScanDocument(init);
    return jsonResponse(501, { error: 'Der Scanner ist nur in der Desktop- oder Android-App verfügbar.' });
  }
  if (url === '/api/scan-models') {
    if (isAndroid()) return androidListModels(init);
    if (isElectron()) return electronListModels(init);
    return jsonResponse(501, { error: 'Die Modell-Liste ist nur in der Desktop- oder Android-App verfügbar.' });
  }
  return fetch(url, init);
}

async function electronListModels(init?: RequestInit): Promise<Response> {
  const api = window.electronAPI;
  if (!api?.listScanModels) {
    return jsonResponse(501, { error: 'Scanner-Bridge nicht verfügbar.' });
  }
  const result = await api.listScanModels(parseInit(init));
  const body = result.body instanceof Uint8Array ? '{}' : JSON.stringify(result.body ?? {});
  return new Response(body, {
    status: result.status,
    headers: result.headers || { 'Content-Type': 'application/json' },
  });
}

async function androidListModels(init?: RequestInit): Promise<Response> {
  const payload = parseInit<{ provider?: ScanProvider; apiKey?: string; accountId?: string }>(init);
  const provider = coerceScanProvider(payload.provider);
  const apiKey = payload.apiKey || '';
  if (!apiKey) return jsonResponse(400, { error: 'Missing apiKey' });

  try {
    const { CapacitorHttp } = await import('@capacitor/core');
    const req = buildModelsRequest(provider, apiKey, payload.accountId);
    const res = await CapacitorHttp.request({
      method: 'GET',
      url: req.url,
      headers: req.headers,
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
    return new Response(bodyText, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err: unknown) {
    // NEVER log the key — only the failure class.
    console.error('[apiBridge:android] scan-models transport failed');
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(502, { error: 'model list transport failed', message });
  }
}

async function electronScanDocument(init?: RequestInit): Promise<Response> {
  const api = window.electronAPI;
  if (!api?.scanDocument) {
    return jsonResponse(501, { error: 'Scanner-Bridge nicht verfügbar.' });
  }
  const payload = parseInit(init);
  const result = await api.scanDocument(payload);
  const body = result.body instanceof Uint8Array ? '{}' : JSON.stringify(result.body ?? {});
  return new Response(body, {
    status: result.status,
    headers: result.headers || { 'Content-Type': 'application/json' },
  });
}

async function androidScanDocument(init?: RequestInit): Promise<Response> {
  const payload = parseInit<{
    provider?: ScanProvider;
    apiKey?: string;
    imageBase64?: string;
    mimeType?: string;
    country?: string;
    accountId?: string;
    scanKind?: ScanKind;
    model?: string;
  }>(init);

  const provider = coerceScanProvider(payload.provider);
  const apiKey = payload.apiKey || '';
  const imageBase64 = payload.imageBase64 || '';
  const mimeType = payload.mimeType || 'image/jpeg';
  const scanKind: ScanKind = payload.scanKind === 'vin' ? 'vin' : 'fahrzeugausweis';

  if (!apiKey || !imageBase64) {
    return jsonResponse(400, { error: 'Missing apiKey or image' });
  }

  try {
    const { CapacitorHttp } = await import('@capacitor/core');
    const req = buildScanRequest(
      provider, apiKey, imageBase64, mimeType,
      payload.country, payload.accountId, scanKind, payload.model,
    );
    const res = await CapacitorHttp.request({
      method: 'POST',
      url: req.url,
      headers: req.headers,
      data: req.body,
      connectTimeout: 15000,
      readTimeout: 60000,
    });
    const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
    return new Response(bodyText, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err: unknown) {
    // NEVER log the key, image, or full error — only the failure class.
    console.error('[apiBridge:android] scan-document transport failed');
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(502, { error: 'scan transport failed', message });
  }
}
