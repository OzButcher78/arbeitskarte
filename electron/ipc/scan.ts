// ============================================================================
// ELECTRON IPC: Vehicle Document Scanner — direct-to-provider vision call
// ----------------------------------------------------------------------------
// The renderer routes /api/scan-document through bridgeFetch → this handler in
// the MAIN process, which builds the exact per-provider request with the shared
// pure scanProviders module and POSTs it straight to the provider using the
// main process's global fetch. No third-party infra is in the loop: the image +
// BYO key go only to the provider the user chose. The key rides in the request
// headers for the call's duration and is NEVER logged or persisted. We return
// the raw provider JSON; documentScanner.ts parses + normalises it.
// ============================================================================

import { buildScanRequest, coerceScanProvider, type ScanKind } from '../../src/scan/scanProviders';
import { jsonResult, type IpcResult } from './types';

export async function scanDocumentIpc(args: any): Promise<IpcResult> {
  const { provider, apiKey, imageBase64, mimeType, country, accountId, scanKind } = args || {};

  const prov = coerceScanProvider(provider);
  const kind: ScanKind = scanKind === 'vin' ? 'vin' : 'fahrzeugausweis';
  if (!apiKey || typeof apiKey !== 'string') {
    return jsonResult(400, { error: 'API-Schlüssel fehlt.' });
  }
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return jsonResult(400, { error: 'Kein Bild übergeben.' });
  }
  if (typeof fetch !== 'function') {
    return jsonResult(500, { error: 'fetch nicht verfügbar im Hauptprozess.' });
  }

  try {
    const req = buildScanRequest(
      prov,
      apiKey,
      imageBase64,
      mimeType || 'image/jpeg',
      country,
      typeof accountId === 'string' ? accountId : undefined,
      kind,
    );
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: 'non_json_provider_response', status: res.status };
    }
    console.log(`[ipc:scan] provider=${prov} status=${res.status}`);
    return jsonResult(res.status, body);
  } catch (err: any) {
    // NEVER log the key or image — only the failure message class.
    console.error('[ipc:scan] ❌ transport failed:', err?.message);
    return jsonResult(502, { error: 'Scan-Anfrage fehlgeschlagen.', details: err?.message });
  }
}
