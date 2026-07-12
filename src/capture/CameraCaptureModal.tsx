// ============================================================================
// CAMERA CAPTURE MODAL — in-app camera with live preview + multi-shot shutter.
// Uses navigator.mediaDevices directly so the rear camera opens on Surface
// tablets, Android tablets, and laptops with webcams the same way.
// ----------------------------------------------------------------------------
// Two layouts, one code path:
//   • variant='photo'    — the classic centered card (job photos, VIN plates).
//   • variant='document' — a full-screen preview with a dotted, card-aspect
//                          alignment outline for the Fahrzeugausweis scan, so the
//                          user fills the frame (bigger card ⇒ better OCR).
// The outline is PURELY COSMETIC (pointer-events-none) and is NEVER baked into the
// captured JPEG — handleShutter rasterizes only the <video>, uncropped, so the
// "whole image" scan contract is preserved.
// ============================================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import { useAndroidBackHandler } from '../platform/androidBackHandler';
import { documentFrameBox, fitContain } from '../scan/scanRedaction';

interface CameraCaptureModalProps {
  /** Called with the captured File[] when the user clicks Done. */
  onCapture: (files: File[]) => void;
  /** Called when the user cancels (X / Escape / Cancel button). */
  onCancel: () => void;
  /** How many more photos the parent will accept this session. */
  remainingSlots: number;
  /**
   * 'photo' (default) = the centered card camera for job photos / VIN plates.
   * 'document' = full-screen preview with a card-aspect alignment outline for the
   * Fahrzeugausweis scan. Drives BOTH the layout and the outline (no foot-gun of
   * two props having to agree).
   */
  variant?: 'photo' | 'document';
  /** Country hint (reserved for future country-specific framing). The A6-landscape
   *  outline is the same for all countries, so this is currently unused. */
  country?: string;
}

interface PendingShot {
  id: string;
  file: File;
  thumbUrl: string;
}

const FRONT_LABEL_REGEX = /front|user|face/i;
const REAR_LABEL_REGEX = /back|rear|world|environment/i;

const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  onCapture,
  onCancel,
  remainingSlots,
  variant = 'photo',
  country: _country,
}) => {
  const { t } = useLocale();
  const tAny = t as any;
  useAndroidBackHandler(() => { onCancel(); });

  const documentMode = variant === 'document';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingShot[]>([]);
  const [error, setError] = useState<'' | 'permission' | 'start_failed' | 'no_device'>('');
  const [starting, setStarting] = useState(true);

  const [contentRect, setContentRect] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openStream = useCallback(async (deviceId?: string) => {
    if (deviceId) {
      return navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' } as any,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    } catch (firstErr: any) {
      if (firstErr?.name === 'OverconstrainedError' || firstErr?.name === 'NotFoundError') {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw firstErr;
    }
  }, []);

  const attachStream = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      try { await videoRef.current.play(); } catch { /* play promise ignored */ }
    }
    const trackId = stream.getVideoTracks()[0]?.getSettings().deviceId || null;
    setCurrentDeviceId(trackId);
  }, []);

  const startStream = useCallback(async (deviceId?: string) => {
    setError('');
    setStarting(true);
    stopStream();
    try {
      let stream = await openStream(deviceId);
      await attachStream(stream);

      let list: MediaDeviceInfo[] = [];
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        list = all.filter((d) => d.kind === 'videoinput');
        setDevices(list);
      } catch { /* enumeration is best-effort */ }

      // Auto-correct front-camera on Surface / Windows tablets (facingMode is a
      // hint there): if we got a front camera and a rear one exists, swap.
      if (!deviceId && list.length >= 2) {
        const currentLabel = stream.getVideoTracks()[0]?.label || '';
        const looksFront = FRONT_LABEL_REGEX.test(currentLabel);
        const looksRear = REAR_LABEL_REGEX.test(currentLabel);
        if (looksFront && !looksRear) {
          const rear = list.find((d) => REAR_LABEL_REGEX.test(d.label) && !FRONT_LABEL_REGEX.test(d.label));
          if (rear) {
            stream.getTracks().forEach((tr) => tr.stop());
            stream = await openStream(rear.deviceId);
            await attachStream(stream);
          }
        }
      }
    } catch (err: any) {
      stopStream();
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setError('permission');
      else if (err?.name === 'NotFoundError') setError('no_device');
      else setError('start_failed');
    } finally {
      setStarting(false);
    }
  }, [stopStream, openStream, attachStream]);

  useEffect(() => {
    startStream();
    return () => {
      stopStream();
      setPending((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
        return prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measureGuide = useCallback(() => {
    if (!documentMode) return;
    const video = videoRef.current;
    if (!video) { setContentRect(null); return; }
    const natW = video.videoWidth;
    const natH = video.videoHeight;
    const boxW = video.clientWidth;
    const boxH = video.clientHeight;
    if (!natW || !natH || !boxW || !boxH) { setContentRect(null); return; }
    const fit = fitContain(natW, natH, boxW, boxH);
    setContentRect({ left: fit.offsetX, top: fit.offsetY, width: fit.w, height: fit.h });
  }, [documentMode]);

  useEffect(() => {
    if (!documentMode) return;
    const video = videoRef.current;
    if (!video) return;
    const onChange = () => measureGuide();
    video.addEventListener('loadedmetadata', onChange);
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onChange);
      ro.observe(video);
    }
    measureGuide();
    return () => {
      video.removeEventListener('loadedmetadata', onChange);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      ro?.disconnect();
    };
    // `error` is a dep so listeners re-attach to the video element that remounts
    // after an error → retry (the <video> is only rendered while error === '').
  }, [documentMode, measureGuide, error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitchCamera = async () => {
    if (devices.length < 2) return;
    const idx = currentDeviceId ? devices.findIndex((d) => d.deviceId === currentDeviceId) : -1;
    const nextIdx = ((idx >= 0 ? idx : 0) + 1) % devices.length;
    await startStream(devices[nextIdx].deviceId);
  };

  const hasMultipleCameras = devices.length >= 2;

  const handleShutter = async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    if (pending.length >= remainingSlots) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Cap the captured frame to a sane long edge BEFORE rasterizing (Android
    // heap / getUserMedia 4K guard). compressImage re-encodes downstream.
    const MAX_CAPTURE_DIM = 1920;
    let w = vw;
    let h = vh;
    if (w > MAX_CAPTURE_DIM || h > MAX_CAPTURE_DIM) {
      if (w >= h) {
        h = Math.round((h / w) * MAX_CAPTURE_DIM);
        w = MAX_CAPTURE_DIM;
      } else {
        w = Math.round((w / h) * MAX_CAPTURE_DIM);
        h = MAX_CAPTURE_DIM;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Only the video is drawn — the alignment outline is an overlay and is never
    // part of the exported bytes (no crop: the whole frame is captured).
    ctx.drawImage(video, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (!blob) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([blob], `kamera-${stamp}.jpg`, { type: 'image/jpeg' });
    const thumbUrl = URL.createObjectURL(blob);
    setPending((prev) => [...prev, { id: stamp, file, thumbUrl }]);
  };

  const handleRemovePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.thumbUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleDone = () => {
    stopStream();
    onCapture(pending.map((p) => p.file));
    pending.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
  };

  const handleCancel = () => {
    stopStream();
    pending.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
    onCancel();
  };

  const reachedLimit = pending.length >= remainingSlots;

  // Card-aspect alignment outline (document mode only), in on-screen coords.
  const frame = documentMode && contentRect
    ? documentFrameBox(contentRect.width, contentRect.height)
    : null;
  const guidePortrait = !!contentRect && contentRect.height > contentRect.width;

  // ── Shared render helpers (identical markup in both layouts) ──────────────
  const renderControls = () => (
    <>
      <div className="w-24 flex justify-start">
        {hasMultipleCameras && error === '' && (
          <button
            onClick={handleSwitchCamera}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title={tAny.cameraSwitch || 'Kamera wechseln'}
          >
            <RotateCcw size={18} />
          </button>
        )}
      </div>

      <button
        onClick={handleShutter}
        disabled={error !== '' || starting || reachedLimit}
        className="w-16 h-16 rounded-full bg-white border-4 border-slate-300 hover:border-white shadow-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
        title={reachedLimit ? (tAny.photoMaxReached || 'Maximum erreicht') : (tAny.cameraShutter || 'Auslösen')}
        aria-label={tAny.cameraShutter || 'Auslösen'}
      />

      <div className="w-24 flex justify-end">
        <button
          onClick={handleDone}
          disabled={pending.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-green-500 hover:bg-green-400 active:bg-green-600 text-white text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Check size={15} />
          {tAny.cameraDone || 'Fertig'}
          {pending.length > 0 && (
            <span className="ml-1 px-1.5 py-0 text-[10px] bg-white/25 rounded tabular-nums">{pending.length}</span>
          )}
        </button>
      </div>
    </>
  );

  const renderPendingStrip = () =>
    pending.length > 0 ? (
      <div className="bg-slate-800 px-3 py-2 border-t border-slate-700 flex items-center gap-2 overflow-x-auto pointer-events-auto">
        {pending.map((p) => (
          <div key={p.id} className="relative flex-shrink-0">
            <img src={p.thumbUrl} alt="" className="w-14 h-14 object-cover rounded border border-slate-600" />
            <button
              onClick={() => handleRemovePending(p.id)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 hover:bg-red-400 text-white flex items-center justify-center shadow"
              title={tAny.photoRemove || 'Entfernen'}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
    ) : null;

  const renderLimitBanner = () =>
    reachedLimit ? (
      <div className="bg-amber-50 text-amber-700 text-[11px] text-center py-1 border-t border-amber-200 pointer-events-auto">
        {tAny.photoMaxReached || 'Maximum erreicht.'}
      </div>
    ) : null;

  const renderErrorContent = () => (
    <>
      <AlertTriangle size={32} className="text-amber-400" />
      <div className="text-sm max-w-md">
        {error === 'permission' && (tAny.cameraPermissionDenied || 'Kamera-Zugriff verweigert. Bitte in den Einstellungen erlauben und erneut versuchen.')}
        {error === 'no_device' && (tAny.cameraNoDevice || 'Keine Kamera erkannt.')}
        {error === 'start_failed' && (tAny.cameraStartFailed || 'Kamera konnte nicht gestartet werden.')}
      </div>
      {error !== 'no_device' && (
        <button
          onClick={() => startStream()}
          className="px-3 py-1.5 text-sm rounded bg-white/10 hover:bg-white/20 border border-white/20 transition-colors"
        >
          {tAny.cameraRetry || 'Erneut versuchen'}
        </button>
      )}
    </>
  );

  // ── Document layout: full-screen preview + dotted card outline ────────────
  if (documentMode) {
    return (
      <div className="fixed inset-0 z-[200] bg-black overflow-hidden">
        {error === '' && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}

        {error === '' && contentRect && frame && (
          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute border-2 border-dotted border-white/85 rounded-xl"
              style={{
                left: contentRect.left + frame.x,
                top: contentRect.top + frame.y,
                width: frame.w,
                height: frame.h,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.30)',
              }}
            />
            <div
              className="absolute left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/60 text-white text-xs font-medium text-center"
              style={{ top: contentRect.top + 12, maxWidth: Math.max(0, contentRect.width - 24) }}
            >
              {guidePortrait
                ? (tAny.cameraDocRotateHint || 'Gerät quer halten – so wird der Ausweis formatfüllend erfasst')
                : (tAny.cameraDocFrameHint || 'Fahrzeugausweis formatfüllend im Rahmen ausrichten')}
            </div>
          </div>
        )}

        {starting && error === '' && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm pointer-events-none">
            {tAny.cameraStarting || 'Kamera wird gestartet…'}
          </div>
        )}
        {error !== '' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6 text-white">
            {renderErrorContent()}
          </div>
        )}

        {/* Header bar */}
        <div
          className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 pointer-events-none"
          style={{
            paddingTop: 'calc(0.6rem + env(safe-area-inset-top))',
            paddingBottom: '0.6rem',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))',
          }}
        >
          <div className="flex items-center gap-2 text-white">
            <Camera size={16} />
            <span className="text-sm font-semibold">{tAny.scanModalTitle || 'Fahrzeugausweis scannen'}</span>
          </div>
          <button
            onClick={handleCancel}
            className="pointer-events-auto p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title={tAny.cameraCancel || 'Abbrechen'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Footer bar */}
        <div
          className="absolute bottom-0 inset-x-0 z-10 pointer-events-none"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom)',
            background: 'linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))',
          }}
        >
          {renderLimitBanner()}
          {renderPendingStrip()}
          <div className="flex items-center justify-between gap-3 px-4 py-3 pointer-events-auto">
            {renderControls()}
          </div>
        </div>
      </div>
    );
  }

  // ── Photo layout: centered card (unchanged) ──────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-2 sm:p-4">
      <div className="w-full max-w-3xl bg-slate-900 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
          <div className="flex items-center gap-2 text-white">
            <Camera size={16} />
            <span className="text-sm font-semibold">{tAny.cameraModalTitle || 'Kamera'}</span>
          </div>
          <button
            onClick={handleCancel}
            className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title={tAny.cameraCancel || 'Abbrechen'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative bg-black flex items-center justify-center" style={{ minHeight: '40vh', maxHeight: '70vh' }}>
          {error === '' && (
            <div className="relative inline-block">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="max-w-full max-h-[70vh] w-auto h-auto object-contain"
              />
            </div>
          )}
          {starting && error === '' && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
              {tAny.cameraStarting || 'Kamera wird gestartet…'}
            </div>
          )}
          {error !== '' && (
            <div className="flex flex-col items-center gap-3 text-center px-6 py-12 text-white">
              {renderErrorContent()}
            </div>
          )}
        </div>

        {renderPendingStrip()}

        <div className="bg-slate-900 px-3 py-3 border-t border-slate-700 flex items-center justify-between gap-3">
          {renderControls()}
        </div>

        {renderLimitBanner()}
      </div>
    </div>
  );
};

export default CameraCaptureModal;
