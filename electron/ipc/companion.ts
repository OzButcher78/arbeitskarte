// ============================================================================
// ELECTRON IPC: LAN photo companion (channels: companion:start/poll/stop)
// ----------------------------------------------------------------------------
// Thin bridge over electron/companion/server.ts. The renderer starts a pairing
// (gets a phone URL to render as a QR code), polls for the uploaded image, and
// stops the pairing when done / cancelled.
// ============================================================================

import { startSession, takeImage, stopSession } from '../companion/server';
import { jsonResult, type IpcResult } from './types';

export async function companionStartIpc(): Promise<IpcResult> {
  try {
    const res = await startSession();
    if ('error' in res) return jsonResult(200, { error: res.error });
    return jsonResult(200, { url: res.url, token: res.token });
  } catch (err: any) {
    console.error('[ipc:companion] start failed:', err?.message);
    return jsonResult(500, { error: 'start_failed' });
  }
}

export function companionPollIpc(args: any): IpcResult {
  const token = typeof args?.token === 'string' ? args.token : '';
  if (!token) return jsonResult(400, { error: 'no_token' });
  const image = takeImage(token);
  return jsonResult(200, image ? { image } : {});
}

export function companionStopIpc(): IpcResult {
  stopSession();
  return jsonResult(200, { ok: true });
}
