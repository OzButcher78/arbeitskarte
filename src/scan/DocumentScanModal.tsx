// ============================================================================
// DocumentScanModal — Vehicle Document Scanner (capture → crop → confirm)
// ----------------------------------------------------------------------------
// Optional BYO-key feature. Photographs the Fahrzeugausweis, sends it DIRECTLY
// to the user's chosen vision provider (via the bridgeFetch seam → device-native
// transport), and lets the user confirm-and-edit the extracted fields — both
// VEHICLE and OWNER (Halter) — before they are applied to the job card.
//
// Owner data IS extracted (Grab's requirement) → the image leaves the device
// towards the provider. Owner-block redaction is an OPT-IN toggle (default off).
// The FULL, un-redacted original capture is handed back so the card can store it.
// Confirm-and-edit is mandatory; nothing is auto-committed.
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera, FolderOpen, Loader2, ScanLine, AlertTriangle, Check, RotateCcw, RotateCw } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import CameraCaptureModal from '../capture/CameraCaptureModal';
import { scanDocument, emptyScanResult, isEmptyScanResult, type ScanResult, type ScanErrorCode } from './documentScanner';
import { type ScanProvider, type ScanKind } from './scanProviders';
import { computeScanCanvas, defaultRedactionBox, rotateRectNormalized, MAX_OUTPUT_EDGE, type Rect } from './scanRedaction';
import { rotateImageDataUrlQuarters } from '../capture/compressImage';

interface DocumentScanModalProps {
  open: boolean;
  /** 'fahrzeugausweis' (default) = full registration document; 'vin' = a VIN
   *  plate on a car part (no holder block, make + approx. year decoded offline). */
  mode?: ScanKind;
  provider: ScanProvider;
  apiKey: string;
  /** Infomaniak Produkt-ID (non-secret), templated into its endpoint URL. */
  accountId?: string;
  /** Country hint passed to the model (date formats). Defaults to CH. */
  country?: string;
  /** When true, seeds an opt-in owner-block redaction box (default false). */
  redactOwner?: boolean;
  onApply: (fields: ScanResult, originalImageDataUrl: string) => void;
  onClose: () => void;
}

type Phase = 'capture' | 'crop' | 'processing' | 'confirm' | 'error';
type ScanTextField = Exclude<keyof ScanResult, 'lowConfidence'>;
type CaptureSource = null | 'camera';
type DragMode = null | 'move' | 'nw' | 'ne' | 'sw' | 'se';
type DragTarget = { box: 'crop' } | { box: 'redact'; index: number };

const HANDLE = 14;

const DocumentScanModal: React.FC<DocumentScanModalProps> = ({
  open, mode = 'fahrzeugausweis', provider, apiKey, accountId, country = 'CH', redactOwner = false,
  onApply, onClose,
}) => {
  const { t } = useLocale();
  const L = useCallback((key: string, fallback: string): string => (t as any)?.[key] || fallback, [t]);
  const isVin = mode === 'vin';

  const [phase, setPhase] = useState<Phase>('capture');
  const [captureSource, setCaptureSource] = useState<CaptureSource>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [originalImageUrl, setOriginalImageUrl] = useState<string>('');
  const [rotationQuarters, setRotationQuarters] = useState(0);
  const [rotating, setRotating] = useState(false);
  const rotatingRef = useRef(false);
  const [rotateError, setRotateError] = useState('');
  const pendingBoxFractionsRef = useRef<{ crop: Rect; redact: Rect[] } | null>(null);
  const [useFullImage, setUseFullImage] = useState(false);
  const [errorCode, setErrorCode] = useState<'auth' | 'error' | 'nothing'>('error');
  const [fields, setFields] = useState<ScanResult>(emptyScanResult());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [redactRects, setRedactRects] = useState<Rect[]>([]);
  const dragRef = useRef<{ target: DragTarget; mode: DragMode; startX: number; startY: number; startRect: Rect } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('capture');
    setCaptureSource(null);
    setImageUrl('');
    setOriginalImageUrl('');
    setRotationQuarters(0);
    setRotating(false);
    rotatingRef.current = false;
    pendingBoxFractionsRef.current = null;
    setRotateError('');
    setUseFullImage(false);
    setErrorCode('error');
    setRedactRects([]);
    setFields(emptyScanResult());
  }, [open]);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (!w || !h) return;
    setDisplaySize({ w, h });
    const pending = pendingBoxFractionsRef.current;
    if (pending) {
      pendingBoxFractionsRef.current = null;
      const denorm = (f: Rect): Rect => ({ x: f.x * w, y: f.y * h, w: f.w * w, h: f.h * h });
      setCrop(denorm(pending.crop));
      setRedactRects(pending.redact.map(denorm));
      rotatingRef.current = false;
      setRotating(false);
      return;
    }
    setCrop((prev) => {
      if (prev.w > 8 && prev.h > 8) return prev;
      if (isVin) {
        return { x: w * 0.1, y: h * 0.35, w: w * 0.8, h: h * 0.3 };
      }
      const insetX = w * 0.02;
      const insetY = h * 0.02;
      return { x: insetX, y: insetY, w: w - insetX * 2, h: h - insetY * 2 };
    });
    // Redaction is opt-in and off by default; only seed a box when enabled.
    if (isVin || !redactOwner) return;
    setRedactRects((prev) => {
      if (prev.length && prev[0].w > 8 && prev[0].h > 8) return prev;
      return [defaultRedactionBox(country, w, h)];
    });
  }, [country, isVin, redactOwner]);

  useEffect(() => {
    if (phase !== 'crop') return;
    const onResize = () => { if (!rotatingRef.current) measure(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [phase, measure]);

  const onPointerDown = (target: DragTarget, mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const startRect = target.box === 'crop' ? crop : (redactRects[target.index] || { x: 0, y: 0, w: 0, h: 0 });
    dragRef.current = { target, mode, startX: e.clientX, startY: e.clientY, startRect: { ...startRect } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !d.mode) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const W = displaySize.w;
    const H = displaySize.h;
    const r = { ...d.startRect };
    const MIN = 30;
    if (d.mode === 'move') {
      r.x = Math.min(Math.max(0, d.startRect.x + dx), W - d.startRect.w);
      r.y = Math.min(Math.max(0, d.startRect.y + dy), H - d.startRect.h);
    } else {
      let left = d.startRect.x;
      let top = d.startRect.y;
      let right = d.startRect.x + d.startRect.w;
      let bottom = d.startRect.y + d.startRect.h;
      if (d.mode === 'nw') { left = Math.min(Math.max(0, left + dx), right - MIN); top = Math.min(Math.max(0, top + dy), bottom - MIN); }
      if (d.mode === 'ne') { right = Math.max(Math.min(W, right + dx), left + MIN); top = Math.min(Math.max(0, top + dy), bottom - MIN); }
      if (d.mode === 'sw') { left = Math.min(Math.max(0, left + dx), right - MIN); bottom = Math.max(Math.min(H, bottom + dy), top + MIN); }
      if (d.mode === 'se') { right = Math.max(Math.min(W, right + dx), left + MIN); bottom = Math.max(Math.min(H, bottom + dy), top + MIN); }
      r.x = left; r.y = top; r.w = right - left; r.h = bottom - top;
    }
    if (d.target.box === 'crop') {
      setCrop(r);
    } else {
      const idx = d.target.index;
      setRedactRects((prev) => prev.map((rr, i) => (i === idx ? r : rr)));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const rotate = async (dir: 'cw' | 'ccw') => {
    if (phase !== 'crop' || rotatingRef.current || !originalImageUrl) return;
    const W = displaySize.w;
    const H = displaySize.h;
    if (!(W > 0) || !(H > 0)) return;
    const cropFrac = rotateRectNormalized(crop, W, H, dir);
    const redactFracs = redactRects.map((r) => rotateRectNormalized(r, W, H, dir));
    const nextQuarters = (rotationQuarters + (dir === 'cw' ? 1 : 3)) % 4;
    rotatingRef.current = true;
    setRotating(true);
    setRotateError('');
    let nextUrl: string;
    try {
      nextUrl = nextQuarters === 0
        ? originalImageUrl
        : (await rotateImageDataUrlQuarters(originalImageUrl, nextQuarters)).dataUrl;
    } catch (e) {
      console.warn('[DocumentScan] rotate failed:', e);
      rotatingRef.current = false;
      setRotating(false);
      setRotateError(L('scanRotateFailed', 'Das Bild konnte nicht gedreht werden.'));
      return;
    }
    pendingBoxFractionsRef.current = { crop: cropFrac, redact: redactFracs };
    setRotationQuarters(nextQuarters);
    setImageUrl(nextUrl);
  };

  const loadImageFromDataUrl = (dataUrl: string) => {
    setImageUrl(dataUrl);
    setOriginalImageUrl(dataUrl);
    setRotationQuarters(0);
    setRotating(false);
    rotatingRef.current = false;
    pendingBoxFractionsRef.current = null;
    setRotateError('');
    setCrop({ x: 0, y: 0, w: 0, h: 0 });
    setUseFullImage(false);
    setRedactRects([]);
    setCaptureSource(null);
    setPhase('crop');
  };

  const handleFilePicked = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') loadImageFromDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCameraCapture = (files: File[]) => {
    setCaptureSource(null);
    handleFilePicked(files[0]);
  };

  const buildCroppedBase64 = (): { base64: string; mimeType: string } | null => {
    const img = imgRef.current;
    if (!img) return null;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (!natW || !natH) return null;

    const plan = computeScanCanvas({
      crop,
      redactRects,
      useFullImage,
      natW,
      natH,
      displayW: displaySize.w,
      displayH: displaySize.h,
      maxEdge: MAX_OUTPUT_EDGE,
    });

    const canvas = document.createElement('canvas');
    canvas.width = plan.canvasW;
    canvas.height = plan.canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { sx, sy, sw, sh } = plan.source;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    // Bake any (opt-in) redaction rectangles — opaque red, permanent in output.
    ctx.fillStyle = '#dc2626';
    for (const f of plan.fills) ctx.fillRect(f.x, f.y, f.w, f.h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const marker = 'base64,';
    const base64 = dataUrl.slice(dataUrl.indexOf(marker) + marker.length);
    return { base64, mimeType: 'image/jpeg' };
  };

  const handleScan = async () => {
    const cropped = buildCroppedBase64();
    if (!cropped) { setErrorCode('error'); setPhase('error'); return; }
    setPhase('processing');
    try {
      const res = await scanDocument({
        provider, apiKey, accountId, imageBase64: cropped.base64, mimeType: cropped.mimeType, country,
        scanKind: mode,
      });
      if (isEmptyScanResult(res)) {
        setErrorCode('nothing');
        setPhase('error');
        return;
      }
      setFields(res);
      setPhase('confirm');
    } catch (e) {
      const code = (e as { code?: ScanErrorCode })?.code;
      setErrorCode(code === 'auth' ? 'auth' : 'error');
      setPhase('error');
    }
  };

  const handleApply = () => {
    // Hand back the FULL, un-redacted original capture so the card can store it.
    onApply(fields, originalImageUrl);
    onClose();
  };

  const setField = (key: ScanTextField, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  if (!open) return null;

  const lowConfidence =
    phase === 'confirm' &&
    (Boolean(fields.lowConfidence) ||
      !fields.chassisNr ||
      fields.chassisNr.replace(/\s+/g, '').length !== 17 ||
      (!isVin && !fields.make));

  if (captureSource === 'camera') {
    return (
      <CameraCaptureModal
        remainingSlots={1}
        onCapture={handleCameraCapture}
        onCancel={() => setCaptureSource(null)}
        redactionGuide={isVin || !redactOwner ? undefined : { country }}
      />
    );
  }

  const fieldRow = (key: ScanTextField, label: string, upper?: boolean) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-0.5">{label}</label>
      <input
        type="text"
        value={fields[key] || ''}
        onChange={(e) => setField(key, upper ? e.target.value.toUpperCase() : e.target.value)}
        className={`w-full px-2 py-1 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${upper ? 'uppercase' : ''}`}
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
              <ScanLine size={18} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                {isVin ? L('scanVinModalTitle', 'VIN scannen') : L('scanModalTitle', 'Fahrzeugausweis scannen')}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isVin
                  ? L('scanVinNote', 'Es werden die Fahrgestellnummer und – falls sichtbar – das Kennzeichen erfasst.')
                  : L('scanOwnerDataNote', 'Fahrzeug- und Halterdaten werden erkannt. Das Bild wird an den gewählten Anbieter gesendet.')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title={L('close', 'Schliessen')}>
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {/* ── Capture step ────────────────────────────────────────────── */}
          {phase === 'capture' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                {isVin
                  ? L('scanVinCapturePrompt', 'Fahrgestellnummer (VIN) fotografieren – Windschutzscheibe, Türholm oder Armaturenbrett.')
                  : L('scanCapturePrompt', 'Fahrzeugausweis aufnehmen oder auswählen.')}
              </p>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setCaptureSource('camera')}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                >
                  <Camera size={18} className="text-blue-600" />
                  <span className="text-sm font-medium text-slate-700">{L('scanCapture', 'Kamera')}</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                >
                  <FolderOpen size={18} className="text-blue-600" />
                  <span className="text-sm font-medium text-slate-700">{L('scanUpload', 'Aus Ordner / Datei')}</span>
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { handleFilePicked(e.target.files?.[0]); e.target.value = ''; }}
              />
              <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
                <span>{isVin
                  ? L('scanVinNote', 'Es werden die Fahrgestellnummer und – falls sichtbar – das Kennzeichen erfasst.')
                  : L('scanPrivacyNote', 'Das Foto (inkl. Halterdaten) wird zur Texterkennung an den in den Einstellungen gewählten Anbieter gesendet.')}</span>
              </div>
              <button
                onClick={onClose}
                className="block w-full text-center text-xs text-slate-500 hover:text-slate-700 underline mt-1"
              >
                {L('scanManualEntry', 'Lieber manuell eingeben (ohne Scan)')}
              </button>
            </div>
          )}

          {/* ── Crop (+ optional redact) step ───────────────────────────── */}
          {phase === 'crop' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                {isVin
                  ? L('scanVinCropHint', 'Blauen Rahmen eng um die 17-stellige Fahrgestellnummer (VIN) ziehen – nur dieser Ausschnitt wird gesendet.')
                  : redactOwner
                    ? L('scanCropRedactHint', 'Blau = Bereich, der gescannt wird. Rot = Halterblock, der vor dem Senden abgedeckt wird. Beide Rahmen verschiebbar.')
                    : L('scanCropHint', 'Blauen Rahmen so ziehen, dass Fahrzeug- und Halterdaten sichtbar sind.')}
              </p>
              <div className="relative flex justify-center bg-slate-100 rounded-lg p-2">
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  <button
                    type="button"
                    onClick={() => void rotate('ccw')}
                    disabled={rotating}
                    className="p-1.5 rounded-lg bg-white/90 shadow border border-slate-200 text-slate-600 hover:bg-white hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={L('scanRotateLeft', 'Nach links drehen')}
                  >
                    {rotating ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void rotate('cw')}
                    disabled={rotating}
                    className="p-1.5 rounded-lg bg-white/90 shadow border border-slate-200 text-slate-600 hover:bg-white hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={L('scanRotateRight', 'Nach rechts drehen')}
                  >
                    {rotating ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
                  </button>
                </div>
                <div ref={wrapRef} className="relative inline-block select-none" style={{ touchAction: 'none' }}>
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    alt=""
                    onLoad={measure}
                    onError={() => { if (rotatingRef.current) { rotatingRef.current = false; setRotating(false); } }}
                    className="block max-w-full"
                    style={{ maxHeight: '52vh' }}
                    draggable={false}
                  />
                  {!useFullImage && displaySize.w > 0 && (
                    <>
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute bg-black/40" style={{ left: 0, top: 0, width: '100%', height: crop.y }} />
                        <div className="absolute bg-black/40" style={{ left: 0, top: crop.y + crop.h, width: '100%', bottom: 0 }} />
                        <div className="absolute bg-black/40" style={{ left: 0, top: crop.y, width: crop.x, height: crop.h }} />
                        <div className="absolute bg-black/40" style={{ left: crop.x + crop.w, top: crop.y, right: 0, height: crop.h }} />
                      </div>
                      <div
                        className="absolute border-2 border-blue-400 cursor-move"
                        style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                        onPointerDown={onPointerDown({ box: 'crop' }, 'move')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      >
                        {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                          <div
                            key={corner}
                            onPointerDown={onPointerDown({ box: 'crop' }, corner)}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            className="absolute bg-blue-500 border border-white rounded-sm"
                            style={{
                              width: HANDLE, height: HANDLE,
                              left: corner.includes('w') ? -HANDLE / 2 : undefined,
                              right: corner.includes('e') ? -HANDLE / 2 : undefined,
                              top: corner.includes('n') ? -HANDLE / 2 : undefined,
                              bottom: corner.includes('s') ? -HANDLE / 2 : undefined,
                              cursor: `${corner}-resize`,
                            }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  {displaySize.w > 0 && redactRects.length > 0 && (
                    <div
                      className="absolute bg-red-600/90 border-2 border-red-700 cursor-move flex items-center justify-center"
                      style={{ left: redactRects[0].x, top: redactRects[0].y, width: redactRects[0].w, height: redactRects[0].h }}
                      onPointerDown={onPointerDown({ box: 'redact', index: 0 }, 'move')}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                    >
                      <div className="px-1 text-center leading-tight pointer-events-none select-none text-white/95">
                        <div className="text-[10px] font-semibold">{L('scanRedactLabel', 'Halterdaten')}</div>
                        <div className="text-[9px] font-normal opacity-90">{L('scanRedactNotSent', 'wird abgedeckt')}</div>
                      </div>
                      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                        <div
                          key={corner}
                          onPointerDown={onPointerDown({ box: 'redact', index: 0 }, corner)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          className="absolute bg-red-700 border border-white rounded-sm"
                          style={{
                            width: HANDLE, height: HANDLE,
                            left: corner.includes('w') ? -HANDLE / 2 : undefined,
                            right: corner.includes('e') ? -HANDLE / 2 : undefined,
                            top: corner.includes('n') ? -HANDLE / 2 : undefined,
                            bottom: corner.includes('s') ? -HANDLE / 2 : undefined,
                            cursor: `${corner}-resize`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {rotateError && <p className="text-[11px] text-red-600 text-center -mt-1">{rotateError}</p>}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setUseFullImage((v) => !v)}
                  className="text-xs text-blue-600 hover:text-blue-700 underline"
                >
                  {useFullImage ? L('scanCrop', 'Ausschnitt wählen') : L('scanUseFullImage', 'Ganzes Bild verwenden')}
                </button>
                <button
                  onClick={() => { setPhase('capture'); setImageUrl(''); }}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  {L('back', 'Zurück')}
                </button>
              </div>
            </div>
          )}

          {/* ── Processing ──────────────────────────────────────────────── */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={28} className="animate-spin mb-3 text-blue-500" />
              <span className="text-sm">{L('scanProcessing', 'Dokument wird ausgelesen…')}</span>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
                <AlertTriangle size={18} className="text-red-600 mt-0.5" />
                <div className="text-sm text-red-700">
                  {errorCode === 'auth'
                    ? L('scanAuthError', 'Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.')
                    : errorCode === 'nothing'
                      ? (isVin
                          ? L('scanVinNothingFound', 'Es konnte keine gültige VIN (17 Zeichen) erkannt werden. Bitte näher und schärfer fotografieren.')
                          : L('scanNothingFound', 'Es konnten keine Daten erkannt werden. Bitte näher / schärfer fotografieren.'))
                      : L('scanError', 'Der Scan ist fehlgeschlagen. Bitte erneut versuchen.')}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setPhase(imageUrl ? 'crop' : 'capture')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {L('retry', 'Erneut versuchen')}
                </button>
              </div>
            </div>
          )}

          {/* ── Confirm + edit ──────────────────────────────────────────── */}
          {phase === 'confirm' && (
            <div className="space-y-3">
              {lowConfidence && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{L('scanConfidenceLow', 'Bitte die erkannten Werte sorgfältig prüfen – einige Felder sind möglicherweise unvollständig.')}</span>
                </div>
              )}
              {isVin ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fieldRow('chassisNr', L('chassisNr', 'Fahrgestellnummer'), true)}
                  <div>
                    {fieldRow('make', L('make', 'Marke'))}
                    <p className="text-[10px] text-slate-400 mt-0.5">{L('scanVinDecodedMakeHint', 'Marke aus der VIN abgeleitet – bitte prüfen.')}</p>
                  </div>
                  <div>
                    {fieldRow('erstzulassung', L('erstzulassung', 'Erstzulassung'))}
                    <p className="text-[10px] text-amber-600 mt-0.5">{L('scanVinModelYearHint', '≈ Modelljahr aus der VIN (nicht Erstzulassung) – bitte prüfen.')}</p>
                  </div>
                  {fieldRow('licensePlate', L('licensePlate', 'Kennzeichen'), true)}
                </div>
              ) : (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{L('sectionVehicle', 'Fahrzeug')}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fieldRow('make', L('make', 'Marke'))}
                    {fieldRow('model', L('model', 'Modell'))}
                    {fieldRow('licensePlate', L('licensePlate', 'Kennzeichen'), true)}
                    {fieldRow('chassisNr', L('chassisNr', 'Fahrgestellnummer'), true)}
                    {fieldRow('stammnummer', L('stammnummer', 'Stammnummer'))}
                    {fieldRow('color', L('color', 'Farbe'))}
                    {fieldRow('erstzulassung', L('erstzulassung', 'Erstzulassung'))}
                    {fieldRow('insurance', L('insurance', 'Versicherung'))}
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 pt-1">{L('sectionOwner', 'Halter')}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fieldRow('halterName', L('halterName', 'Name'))}
                    {fieldRow('halterVorname', L('halterVorname', 'Vorname'))}
                    {fieldRow('halterStrasse', L('halterStrasse', 'Strasse'))}
                    {fieldRow('halterPlz', L('halterPlz', 'PLZ'))}
                    {fieldRow('halterOrt', L('halterOrt', 'Ort'))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium">
            {L('cancel', 'Abbrechen')}
          </button>
          {phase === 'crop' && (
            <button
              onClick={() => void handleScan()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <ScanLine size={15} />
              {L('scanDocument', 'Scannen')}
            </button>
          )}
          {phase === 'confirm' && (
            <button
              onClick={handleApply}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <Check size={15} />
              {L('scanApply', 'Übernehmen')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentScanModal;
