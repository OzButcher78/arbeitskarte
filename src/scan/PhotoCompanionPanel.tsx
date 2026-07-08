// ============================================================================
// PhotoCompanionPanel — pair a phone via QR to shoot a photo into the app.
// ----------------------------------------------------------------------------
// Electron-only. Starts a LAN pairing (electron/companion), renders the phone
// URL as a QR code, and polls until the phone uploads a photo — then hands the
// data URL back via onImage(). The pairing is torn down on unmount / cancel.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, X, Loader2, AlertTriangle } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import { startCompanion, pollCompanion, stopCompanion } from '../platform/companion';

interface Props {
  onImage: (dataUrl: string) => void;
  onCancel: () => void;
}

type State =
  | { kind: 'starting' }
  | { kind: 'waiting'; url: string; token: string; qr: string }
  | { kind: 'error'; code: string };

export default function PhotoCompanionPanel({ onImage, onCancel }: Props) {
  const { t } = useLocale();
  const L = (key: string, fallback: string): string => (t as any)?.[key] || fallback;
  const [state, setState] = useState<State>({ kind: 'starting' });
  // True once we've waited a while with no photo — surfaces firewall/WLAN help.
  const [slow, setSlow] = useState(false);
  // Latest onImage without retriggering the effect.
  const onImageRef = useRef(onImage);
  onImageRef.current = onImage;

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;

    const cleanupTimers = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
    };

    (async () => {
      const res = await startCompanion();
      if (cancelled) return;
      if ('error' in res) {
        setState({ kind: 'error', code: res.error });
        return;
      }
      let qr = '';
      try {
        qr = await QRCode.toDataURL(res.url, { margin: 1, width: 240 });
      } catch {
        qr = '';
      }
      if (cancelled) return;
      setState({ kind: 'waiting', url: res.url, token: res.token, qr });
      slowTimer = setTimeout(() => { if (!cancelled) setSlow(true); }, 25_000);

      pollTimer = setInterval(async () => {
        if (polling) return; // don't let a slow IPC round-trip overlap
        polling = true;
        try {
          const image = await pollCompanion(res.token);
          if (cancelled || !image) return;
          cleanupTimers();
          void stopCompanion();
          onImageRef.current(image);
        } finally {
          polling = false;
        }
      }, 1500);
    })();

    return () => {
      cancelled = true;
      cleanupTimers();
      void stopCompanion();
    };
  }, []);

  const errorText = (code: string): string =>
    code === 'no_lan'
      ? L('companionNoLan', 'Keine Netzwerkverbindung gefunden. Der Computer muss mit einem WLAN/LAN verbunden sein.')
      : code === 'unavailable'
        ? L('companionUnavailable', 'Diese Funktion ist nur in der Desktop-App verfügbar.')
        : L('companionStartFailed', 'Die Verbindung konnte nicht gestartet werden.');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[65] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
              <Smartphone size={18} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">{L('companionTitle', 'Foto vom Handy')}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{L('companionSubtitle', 'QR-Code mit dem Handy scannen')}</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" title={L('close', 'Schliessen')}>
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col items-center text-center">
          {state.kind === 'starting' && (
            <div className="flex flex-col items-center py-8 text-slate-500">
              <Loader2 size={26} className="animate-spin mb-3 text-blue-500" />
              <span className="text-sm">{L('companionStarting', 'Verbindung wird gestartet …')}</span>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200 text-left">
              <AlertTriangle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-700">{errorText(state.code)}</div>
            </div>
          )}

          {state.kind === 'waiting' && (
            <>
              {state.qr ? (
                <img src={state.qr} alt="QR-Code" width={220} height={220} className="rounded-lg border border-slate-200" />
              ) : (
                <div className="text-xs text-slate-500 break-all px-2">{state.url}</div>
              )}
              <p className="mt-4 text-sm text-slate-600">
                {L('companionScanHint', 'Mit der Kamera-App des Handys scannen, ein Foto aufnehmen – es erscheint automatisch hier.')}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" />
                <span>{L('companionWaiting', 'Warte auf Foto vom Handy …')}</span>
              </div>
              {state.qr && (
                <p className="mt-3 text-[11px] text-slate-400 break-all">
                  {L('companionOrType', 'Oder im Browser öffnen:')} <span className="font-mono text-slate-500">{state.url}</span>
                </p>
              )}
              {slow ? (
                <p className="mt-3 text-[11px] text-amber-600">
                  {L('companionSlowHint', 'Noch kein Foto empfangen. Bitte prüfen: gleiches WLAN, und beim ersten Mal die Windows-Firewall-Abfrage erlauben.')}
                </p>
              ) : (
                <p className="mt-3 text-[11px] text-slate-400">{L('companionSameWifi', 'Handy und Computer müssen im selben WLAN sein.')}</p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end px-5 py-3 border-t border-slate-100">
          <button onClick={onCancel} className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium">
            {L('cancel', 'Abbrechen')}
          </button>
        </div>
      </div>
    </div>
  );
}
