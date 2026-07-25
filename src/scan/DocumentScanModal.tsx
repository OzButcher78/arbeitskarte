// ============================================================================
// DocumentScanModal — Vehicle Document Scanner (capture → scan → confirm)
// ----------------------------------------------------------------------------
// Optional BYO-key feature. Photographs the Fahrzeugausweis (or picks a file),
// sends the WHOLE image DIRECTLY to the user's chosen vision provider (via the
// bridgeFetch seam → device-native transport), and lets the user confirm-and-edit
// the extracted fields — both VEHICLE and OWNER (Halter) — before they are
// applied to the job card.
//
// There is deliberately NO crop / resize / redaction step: the full frame taken
// with the camera or attached from a file is used as-is (it just gets downscaled
// + re-encoded to JPEG for a faster, cheaper call). The un-redacted original is
// handed back so the card can store it. Confirm-and-edit is mandatory; nothing is
// auto-committed. Owner data IS extracted (Grab's requirement) → the image leaves
// the device towards the provider; the Settings compliance ack covers this.
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FolderOpen, Loader2, ScanLine, AlertTriangle, Check, Smartphone, Cpu, Cloud } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useLocale } from '../i18n/locale';
import CameraCaptureModal from '../capture/CameraCaptureModal';
import PhotoCompanionPanel from './PhotoCompanionPanel';
import { scanDocument, emptyScanResult, isEmptyScanResult, type ScanResult, type ScanErrorCode } from './documentScanner';
import { type ScanProvider, type ScanKind } from './scanProviders';
import { compressImage } from '../capture/compressImage';
import { dataUrlToBlob } from '../utils/dataUrl';
import { isCompanionAvailable } from '../platform/companion';
import { isBrowser } from '../platform/detect';

interface DocumentScanModalProps {
  open: boolean;
  /** Initial scan kind: 'fahrzeugausweis' (default) = full registration
   *  document; 'vin' = a VIN plate on a car part (no holder block, make +
   *  approx. year decoded offline). The user can switch in the capture step. */
  mode?: ScanKind;
  provider: ScanProvider;
  apiKey: string;
  /** Infomaniak Produkt-ID (non-secret), templated into its endpoint URL. */
  accountId?: string;
  /** Optional model-id override from Settings. Empty → the provider default. */
  model?: string;
  /** True when the cloud (KI) path is fully configured (key + ack + account).
   *  When false, only the offline OCR engine is available. */
  cloudReady: boolean;
  /** Country hint passed to the model (date formats). Defaults to CH. */
  country?: string;
  onApply: (fields: ScanResult, originalImageDataUrl: string) => void;
  onClose: () => void;
}

/** Which scanner runs: on-device Tesseract OCR, or the cloud vision model. */
type ScanEngine = 'local' | 'cloud';

type Phase = 'capture' | 'processing' | 'confirm' | 'error';
type ScanTextField = Exclude<keyof ScanResult, 'lowConfidence'>;
type CaptureSource = null | 'camera' | 'companion';

/** Downscale + re-encode a full-frame data URL to base64 JPEG for the scan call
 *  (strips EXIF/GPS, caps the long edge). The WHOLE image is kept — no crop. */
async function encodeFullImage(dataUrl: string): Promise<{ base64: string; mimeType: string }> {
  const blob = await dataUrlToBlob(dataUrl);
  const compressed = await compressImage(blob, 'high');
  const marker = 'base64,';
  const idx = compressed.dataUrl.indexOf(marker);
  const base64 = idx >= 0 ? compressed.dataUrl.slice(idx + marker.length) : compressed.dataUrl;
  return { base64, mimeType: 'image/jpeg' };
}

const DocumentScanModal: React.FC<DocumentScanModalProps> = ({
  open, mode = 'fahrzeugausweis', provider, apiKey, accountId, model, cloudReady, country = 'CH',
  onApply, onClose,
}) => {
  const { t } = useLocale();
  const L = useCallback((key: string, fallback: string): string => (t as any)?.[key] || fallback, [t]);
  // The VIN path (prompt, offline decoder, confirm form, strings) was fully
  // implemented but unreachable — nothing ever passed `mode`. Rather than adding
  // another button to the editor toolbar, the choice lives in the capture step
  // of this dialog, where it is a property of the scan being taken.
  const [kind, setKind] = useState<ScanKind>(mode);
  const isVin = kind === 'vin';
  // Offline OCR is Fahrzeugausweis-only for now; the VIN plate read stays cloud.
  const canUseLocal = !isVin;
  // The cloud call needs a native transport (Electron IPC / CapacitorHttp) to get
  // past CORS — in a plain browser it can only ever answer HTTP 501. Say so up
  // front instead of letting the user hit an error screen.
  const cloudSupported = !isBrowser();
  const cloudUsable = cloudReady && cloudSupported;
  const cloudBlockedNote = !cloudSupported
    ? L('scanEngineOnlineBrowser', 'Online-Scan nur in der Desktop- oder Tablet-App — hier bitte Offline verwenden.')
    : L('scanEngineOnlineUnavailable', 'Online-KI zuerst in den Einstellungen einrichten.');

  const [phase, setPhase] = useState<Phase>('capture');
  const [captureSource, setCaptureSource] = useState<CaptureSource>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string>('');
  const [errorCode, setErrorCode] = useState<'auth' | 'error' | 'nothing'>('error');
  /** The provider's/transport's own words, kept alongside the coarse bucket so
   *  "no network", "rate limit", "no credit" and "not supported here" stay
   *  distinguishable instead of collapsing into "Scan fehlgeschlagen". */
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [fields, setFields] = useState<ScanResult>(emptyScanResult());
  // Default to the cloud when it's usable (more accurate); otherwise offline.
  const [engine, setEngine] = useState<ScanEngine>(cloudUsable && canUseLocal ? 'cloud' : canUseLocal ? 'local' : 'cloud');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setKind(mode);
    setPhase('capture');
    setCaptureSource(null);
    setOriginalImageUrl('');
    setErrorCode('error');
    setErrorDetail('');
    setFields(emptyScanResult());
    setEngine(cloudUsable && canUseLocal ? 'cloud' : canUseLocal ? 'local' : 'cloud');
  }, [open, mode, cloudUsable, canUseLocal]);

  // Switching to VIN takes the offline engine off the table (Tesseract can't do
  // the plate read), so the engine has to follow — otherwise `useLocal` silently
  // resolves to false and the scan runs on the cloud while the UI still says
  // offline.
  useEffect(() => {
    if (isVin && engine === 'local') setEngine('cloud');
  }, [isVin, engine]);

  // Warm the on-device engine (loads the wasm/lang) as soon as offline is chosen,
  // so the first scan isn't stuck waiting on the ~14 MB payload. Dynamic-imported
  // so tesseract.js stays out of the main bundle until offline is actually used.
  useEffect(() => {
    if (open && engine === 'local') void import('./localOcr/engine').then((m) => m.warmUpLocalOcr());
  }, [open, engine]);

  /** `engineOverride` lets the error screen retry the SAME image on the other
   *  engine without going back to the capture step. */
  const runScan = useCallback(async (dataUrl: string, engineOverride?: ScanEngine) => {
    const chosen = engineOverride ?? engine;
    if (engineOverride) setEngine(engineOverride);
    setOriginalImageUrl(dataUrl);
    setPhase('processing');
    setErrorDetail('');
    const useLocal = chosen === 'local' && canUseLocal;
    try {
      const { base64, mimeType } = await encodeFullImage(dataUrl);
      const res = await scanDocument({
        provider: useLocal ? 'local' : provider,
        apiKey: useLocal ? '' : apiKey,
        accountId, model, imageBase64: base64, mimeType, country, scanKind: kind,
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
      setErrorDetail(e instanceof Error ? e.message : String(e ?? ''));
      setPhase('error');
    }
  }, [provider, apiKey, accountId, model, country, kind, engine, canUseLocal]);

  const handleFilePicked = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') void runScan(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCameraCapture = (files: File[]) => {
    setCaptureSource(null);
    handleFilePicked(files[0]);
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
        variant={isVin ? 'photo' : 'document'}
        country={country}
      />
    );
  }

  if (captureSource === 'companion') {
    return (
      <PhotoCompanionPanel
        onImage={(dataUrl) => { setCaptureSource(null); void runScan(dataUrl); }}
        onCancel={() => setCaptureSource(null)}
      />
    );
  }

  const fieldRow = (key: ScanTextField, label: string, upper?: boolean) => (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{label}</label>
      <input
        type="text"
        value={fields[key] || ''}
        onChange={(e) => setField(key, upper ? e.target.value.toUpperCase() : e.target.value)}
        className={`w-full rounded-control border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 ${upper ? 'uppercase' : ''}`}
      />
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="max-w-xl"
      title={isVin ? L('scanVinModalTitle', 'VIN scannen') : L('scanModalTitle', 'Fahrzeugausweis scannen')}
      subtitle={
        isVin
          ? L('scanVinNote', 'Es werden die Fahrgestellnummer und – falls sichtbar – das Kennzeichen erfasst.')
          : L('scanOwnerDataNote', 'Fahrzeug- und Halterdaten werden erkannt. Das Bild wird an den gewählten Anbieter gesendet.')
      }
      leading={
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft">
          <ScanLine size={18} className="text-accent" />
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L('cancel', 'Abbrechen')}
          </Button>
          {phase === 'confirm' && (
            <Button variant="primary" onClick={handleApply} icon={<Check size={15} />}>
              {L('scanApply', 'Übernehmen')}
            </Button>
          )}
        </>
      }
    >
        <div>
          {/* ── Capture step ────────────────────────────────────────────── */}
          {phase === 'capture' && (
            <div className="space-y-3">
              {/* What is being scanned. Separate from the engine switch below:
                  this picks the extraction contract, that picks where it runs. */}
              <div className="flex gap-1 rounded-control bg-surface-sunken p-1">
                <button
                  type="button"
                  onClick={() => setKind('fahrzeugausweis')}
                  aria-pressed={!isVin}
                  className={`flex-1 rounded-control px-3 py-1.5 text-sm font-semibold transition-colors ${!isVin ? 'bg-paper text-accent-strong shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  {L('scanKindAusweis', 'Fahrzeugausweis')}
                </button>
                <button
                  type="button"
                  onClick={() => setKind('vin')}
                  aria-pressed={isVin}
                  className={`flex-1 rounded-control px-3 py-1.5 text-sm font-semibold transition-colors ${isVin ? 'bg-paper text-accent-strong shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  {L('scanKindVin', 'Fahrgestell-Nr.')}
                </button>
              </div>
              {isVin && (
                <p className="text-[11px] text-muted">
                  {cloudUsable
                    ? L('scanVinOnlineOnly', 'Der VIN-Scan läuft nur über die Online-KI – die Offline-Erkennung kann ihn nicht lesen.')
                    : cloudBlockedNote}
                </p>
              )}
              {canUseLocal && (
                <div>
                  <div className="flex gap-1 p-1 rounded-lg bg-surface-sunken">
                    <button
                      type="button"
                      onClick={() => setEngine('local')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${engine === 'local' ? 'bg-white shadow-sm text-accent-strong' : 'text-muted hover:text-ink'}`}
                    >
                      <Cpu size={15} /> {L('scanEngineOffline', 'Offline (OCR)')}
                    </button>
                    <button
                      type="button"
                      onClick={() => cloudUsable && setEngine('cloud')}
                      disabled={!cloudUsable}
                      title={cloudUsable ? undefined : cloudBlockedNote}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${engine === 'cloud' ? 'bg-white shadow-sm text-accent-strong' : 'text-muted hover:text-ink'} ${!cloudUsable ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <Cloud size={15} /> {L('scanEngineOnline', 'Online (KI)')}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted mt-1.5">
                    {engine === 'local'
                      ? L('scanEngineOfflineDesc', 'Texterkennung läuft vollständig auf diesem Gerät – es verlassen keine Daten den Computer.')
                      : cloudUsable
                        ? L('scanEngineOnlineDesc', 'Genauer – das Bild wird zur Erkennung an den in den Einstellungen gewählten Anbieter gesendet.')
                        : cloudBlockedNote}
                  </p>
                  {!cloudSupported && (
                    <p className="text-[11px] text-amber-600 mt-1">{cloudBlockedNote}</p>
                  )}
                </div>
              )}
              <p className="text-sm text-ink">
                {isVin
                  ? L('scanVinCapturePrompt', 'Fahrgestellnummer (VIN) fotografieren – Windschutzscheibe, Türholm oder Armaturenbrett.')
                  : engine === 'local'
                    ? L('scanCapturePromptLocal', 'Fahrzeugausweis aufnehmen oder auswählen – die Erkennung läuft offline auf diesem Gerät.')
                    : L('scanCapturePrompt', 'Fahrzeugausweis aufnehmen oder auswählen – das ganze Bild wird gesendet.')}
              </p>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setCaptureSource('camera')}
                  className="flex items-center gap-3 p-3 rounded-lg border border-line hover:border-accent hover:bg-accent-soft transition-colors text-left"
                >
                  <Camera size={18} className="text-accent" />
                  <span className="text-sm font-medium text-ink">{L('scanCapture', 'Kamera')}</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-3 p-3 rounded-lg border border-line hover:border-accent hover:bg-accent-soft transition-colors text-left"
                >
                  <FolderOpen size={18} className="text-accent" />
                  <span className="text-sm font-medium text-ink">{L('scanUpload', 'Aus Ordner / Datei')}</span>
                </button>
                {isCompanionAvailable() && (
                  <button
                    onClick={() => setCaptureSource('companion')}
                    className="flex items-center gap-3 p-3 rounded-lg border border-line hover:border-accent hover:bg-accent-soft transition-colors text-left"
                  >
                    <Smartphone size={18} className="text-accent" />
                    <span className="text-sm font-medium text-ink">{L('scanCompanion', 'QR vom Handy')}</span>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                // Explicit extensions alongside image/* — on Windows/Chromium the
                // image/* filter is built from registry MIME associations and can
                // omit .jpg/.jpeg if those aren't associated with image/jpeg.
                accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                className="hidden"
                onChange={(e) => { handleFilePicked(e.target.files?.[0]); e.target.value = ''; }}
              />
              <div className="flex items-start gap-2 rounded-control border border-line bg-surface-sunken p-3 text-[11px] text-muted">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-faint" />
                <span>{isVin
                  ? L('scanVinNote', 'Es werden die Fahrgestellnummer und – falls sichtbar – das Kennzeichen erfasst.')
                  : engine === 'local'
                    ? L('scanLocalPrivacyNote', 'Offline-Texterkennung: Foto und Halterdaten bleiben vollständig auf diesem Gerät.')
                    : L('scanPrivacyNote', 'Das Foto (inkl. Halterdaten) wird zur Texterkennung an den in den Einstellungen gewählten Anbieter gesendet.')}</span>
              </div>
              <button
                onClick={onClose}
                className="block w-full text-center text-xs text-muted hover:text-ink underline mt-1"
              >
                {L('scanManualEntry', 'Lieber manuell eingeben (ohne Scan)')}
              </button>
            </div>
          )}

          {/* ── Processing ──────────────────────────────────────────────── */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 text-muted">
              <Loader2 size={28} className="animate-spin mb-3 text-accent" />
              <span className="text-sm">
                {engine === 'local'
                  ? L('scanLocalProcessing', 'Texterkennung läuft auf diesem Gerät … (kann einige Sekunden dauern)')
                  : L('scanProcessing', 'Dokument wird ausgelesen…')}
              </span>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-danger-soft border border-danger/30">
                <AlertTriangle size={18} className="text-danger mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm text-danger-strong">
                    {errorCode === 'auth'
                      ? L('scanAuthError', 'Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.')
                      : errorCode === 'nothing'
                        ? (isVin
                            ? L('scanVinNothingFound', 'Es konnte keine gültige VIN (17 Zeichen) erkannt werden. Bitte näher und schärfer fotografieren.')
                            : L('scanNothingFound', 'Es konnten keine Daten erkannt werden. Bitte näher / schärfer fotografieren.'))
                        : L('scanError', 'Der Scan ist fehlgeschlagen. Bitte erneut versuchen.')}
                  </div>
                  {errorDetail && (
                    <div className="mt-1.5 text-[11px] text-muted break-words">{errorDetail}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {canUseLocal && engine === 'cloud' && originalImageUrl && (
                  <button
                    onClick={() => void runScan(originalImageUrl, 'local')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 border border-line-strong text-ink hover:bg-surface text-sm font-medium rounded-control transition-colors"
                  >
                    <Cpu size={15} /> {L('scanRetryOffline', 'Mit Offline-Erkennung versuchen')}
                  </button>
                )}
                <button
                  onClick={() => (originalImageUrl ? void runScan(originalImageUrl) : setPhase('capture'))}
                  className="ui-control px-4 py-2 bg-accent hover:bg-accent-strong text-white text-sm font-semibold rounded-control transition-colors"
                >
                  {L('retry', 'Erneut versuchen')}
                </button>
                <button
                  onClick={() => setPhase('capture')}
                  className="px-4 py-2 text-muted hover:text-ink text-sm font-medium"
                >
                  {L('scanNewPhoto', 'Neues Foto')}
                </button>
              </div>
            </div>
          )}

          {/* ── Confirm + edit ──────────────────────────────────────────── */}
          {phase === 'confirm' && (
            <div className="space-y-3">
              {lowConfidence && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{L('scanConfidenceLow', 'Bitte die erkannten Werte sorgfältig prüfen – einige Felder sind möglicherweise unvollständig.')}</span>
                </div>
              )}
              {isVin ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fieldRow('chassisNr', L('chassisNr', 'Fahrgestellnummer'), true)}
                  <div>
                    {fieldRow('make', L('make', 'Marke'))}
                    <p className="text-[10px] text-faint mt-0.5">{L('scanVinDecodedMakeHint', 'Marke aus der VIN abgeleitet – bitte prüfen.')}</p>
                  </div>
                  <div>
                    {fieldRow('erstzulassung', L('erstzulassung', 'Erstzulassung'))}
                    <p className="text-[10px] text-amber-600 mt-0.5">{L('scanVinModelYearHint', '≈ Modelljahr aus der VIN (nicht Erstzulassung) – bitte prüfen.')}</p>
                  </div>
                  {fieldRow('licensePlate', L('licensePlate', 'Kennzeichen'), true)}
                </div>
              ) : (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{L('sectionVehicle', 'Fahrzeug')}</div>
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
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-faint pt-1">{L('sectionOwner', 'Halter')}</div>
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
    </Modal>
  );
};

export default DocumentScanModal;
