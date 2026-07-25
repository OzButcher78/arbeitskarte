// ============================================================================
// SettingsModal — Betrieb (workshop identity) + Nummerierung + Scanner.
// The scanner API key is stored via the credential store, never in settings.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ExternalLink, FolderOpen, Download, Upload, Loader2, RefreshCw } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import type { AppSettings, ScanProviderId } from '../types/jobcard';
import { SCAN_PROVIDER_META, SCAN_MODELS } from '../scan/scanProviders';
import { getDocScanKey, setDocScanKey } from '../platform/credentialStore';
import { listScanModels } from '../scan/documentScanner';
import { formatJobNumber } from '../numbering/jobNumber';
import { runBackup, LAST_BACKUP_KEY } from '../backup/runBackup';
import { pickBackupDir, revealBackupFolder } from '../backup/backupTarget';
import { parseBackup, restoreBackup, hasVersionMismatch } from '../backup/restoreBackup';
import { setMeta } from '../storage/jobCardRepository';
import { db } from '../storage/db';
import { isElectron, isAndroid } from '../platform/detect';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { inputClass, labelClass } from '../ui/form';

interface Props {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  /** Called after a successful restore so the parent can reload the card list. */
  onDataRestored?: () => void;
}

const PROVIDER_ORDER: ScanProviderId[] = ['infomaniak', 'mistral', 'openai', 'anthropic'];

/** True once the scanner has everything it needs to run the cloud path: an API
 *  key, plus the Produkt-ID for providers that require one (Infomaniak). Used to
 *  auto-enable the scanner so the user doesn't forget to tick "Scanner aktivieren". */
function scanCredsComplete(key: string, accountId: string | undefined, provider: ScanProviderId): boolean {
  if (!key.trim()) return false;
  if (SCAN_PROVIDER_META[provider].requiresAccountId && !(accountId || '').trim()) return false;
  return true;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function SettingsModal({ open, settings, onSave, onClose, onDataRestored }: Props) {
  const { t } = useLocale();
  const L = (key: string, fallback: string): string => (t as any)?.[key] || fallback;
  const { confirm, choose } = useConfirm();
  const toast = useToast();

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);
  /** The provider's model catalogue, fetched on demand with the entered key. */
  const [models, setModels] = useState<{ state: 'idle' | 'loading' | 'loaded' | 'error'; ids: string[]; error?: string }>(
    { state: 'idle', ids: [] },
  );
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setApiKey(getDocScanKey());
    setShowKey(false);
    setBusy(null);
    setBackupMsg(null);
    setModels({ state: 'idle', ids: [] });
  }, [open, settings]);

  // Bail out while closed. Modal would render nothing anyway, but everything
  // below — including the isDirty comparison and its credential-store read —
  // would otherwise run on EVERY App render, e.g. on each keystroke in the
  // list's search box.
  if (!open) return null;

  const meta = SCAN_PROVIDER_META[draft.docScanProvider];
  const update = (patch: Partial<AppSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const updateShop = (patch: Partial<AppSettings['workshop']>) =>
    setDraft((d) => ({ ...d, workshop: { ...d.workshop, ...patch } }));

  const handleLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      updateShop({ logoDataUrl: await readFileAsDataUrl(file) });
    } catch { /* ignore */ }
  };

  /** Ask the provider which models the entered key may use, so a retired
   *  default can be replaced here instead of in a new release. */
  const handleLoadModels = async () => {
    setModels({ state: 'loading', ids: [] });
    try {
      const ids = await listScanModels({
        provider: draft.docScanProvider,
        apiKey: apiKey.trim(),
        accountId: draft.docScanProviderAccountId,
      });
      setModels({ state: 'loaded', ids });
    } catch (e) {
      setModels({ state: 'error', ids: [], error: e instanceof Error ? e.message : String(e) });
    }
  };

  const handlePickDir = async () => {
    const dir = await pickBackupDir();
    if (dir) { update({ backupDir: dir }); setBackupMsg(null); }
  };

  const handleBackupNow = async () => {
    setBusy('backup');
    setBackupMsg(null);
    try {
      const res = await runBackup(draft);
      if (res.ok) {
        setBackupMsg({
          ok: true,
          text: res.method === 'download'
            ? L('backupDoneDownload', 'Sicherung als Download gespeichert.')
            : `${L('backupDone', 'Sicherung gespeichert')}${res.path ? ': ' + res.path : ''}`,
        });
      } else {
        setBackupMsg({ ok: false, text: res.error || L('backupFailed', 'Sicherung fehlgeschlagen.') });
      }
    } catch (e) {
      setBackupMsg({ ok: false, text: `${L('backupFailed', 'Sicherung fehlgeschlagen.')} ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const env = parseBackup(text);
      if (!env) {
        setBackupMsg({ ok: false, text: L('restoreInvalid', 'Ungültige Sicherungsdatei.') });
        return;
      }
      // ONE dialog with named buttons. This used to be up to four chained
      // window.confirm prompts in which "Abbrechen" on the third silently meant
      // "Zusammenführen" — a destructive three-way choice encoded as OK/Cancel.
      const mode = await choose<'replace' | 'merge'>({
        title: L('restoreTitle', 'Sicherung wiederherstellen'),
        message: (
          <div className="space-y-3">
            <p>
              {L('restoreBody', 'Wie soll die Sicherung eingespielt werden?')}{' '}
              <span className="text-muted">
                ({new Date(env.exportedAt).toLocaleString('de-CH')} · {env.counts.jobcards} Karten,{' '}
                {env.counts.blobs} Bilder)
              </span>
            </p>
            {hasVersionMismatch(env) && (
              <p className="rounded-control bg-danger-soft px-3 py-2 text-danger-strong">
                {L('restoreVersionWarn', 'Diese Sicherung stammt aus einer anderen Programmversion. Das Einspielen kann fehlschlagen.')}{' '}
                ({env.dbVersion} statt {db.verno})
              </p>
            )}
            <ul className="space-y-1.5 text-muted">
              <li>
                <strong className="text-ink">{L('restoreReplace', 'Alle ersetzen')}:</strong>{' '}
                {L('restoreReplaceHint', 'Alle aktuellen Arbeitskarten und Bilder werden gelöscht und durch die Sicherung ersetzt.')}
              </li>
              <li>
                <strong className="text-ink">{L('restoreMerge', 'Zusammenführen')}:</strong>{' '}
                {L('restoreMergeHint', 'Karten aus der Sicherung werden zu den bestehenden hinzugefügt.')}
              </li>
            </ul>
          </div>
        ),
        choices: [
          { value: 'merge', label: L('restoreMerge', 'Zusammenführen'), variant: 'primary' },
          { value: 'replace', label: L('restoreReplace', 'Alle ersetzen'), variant: 'danger' },
        ],
        nested: true,
      });
      if (!mode) return;

      setBusy('restore');
      setBackupMsg(null);
      try {
        const res = await restoreBackup(env, mode);
        if (res.ok) {
          setBackupMsg({ ok: true, text: `${res.jobcards} Karten und ${res.blobs} Bilder wiederhergestellt.` });
          toast.success(L('restoreDone', 'Sicherung eingespielt.'));
          onDataRestored?.();
        } else {
          setBackupMsg({ ok: false, text: res.error || L('restoreFailed', 'Wiederherstellung fehlgeschlagen.') });
        }
      } finally {
        setBusy(null);
      }
    };
    reader.readAsText(file);
  };

  /** Settings only persist on Speichern, so backdrop / ✕ / Escape used to throw
   *  away edits without a word. */
  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings) || apiKey.trim() !== getDocScanKey().trim();

  const handleRequestClose = () => {
    if (!isDirty) return true;
    void (async () => {
      const discard = await confirm({
        title: L('discardTitle', 'Änderungen verwerfen?'),
        message: L('discardBody', 'Die geänderten Einstellungen wurden noch nicht gespeichert.'),
        confirmLabel: L('discardConfirm', 'Verwerfen'),
        cancelLabel: L('keepEditing', 'Weiter bearbeiten'),
        confirmVariant: 'danger',
        nested: true,
      });
      if (discard) onClose();
    })();
    return false;
  };

  const handleSave = () => {
    setDocScanKey(apiKey.trim());
    // Seed lastBackupAt on first enable so auto-backup doesn't fire on the very
    // next launch (honours the chosen interval from now).
    if (draft.backupEnabled && !settings.backupEnabled) {
      void setMeta(LAST_BACKUP_KEY, Date.now());
    }
    onSave(draft);
    onClose();
  };

  // Shared field chrome (src/ui/form) — Settings used to define its own, which
  // is how the app ended up with three different input styles.
  const labelCls = labelClass;
  const inputCls = inputClass;

  return (
    <Modal
      open={open}
      onClose={onClose}
      onRequestClose={handleRequestClose}
      title={L('settingsTitle', 'Einstellungen')}
      size="max-w-2xl"
      footer={
        <>
          <p className="text-[11px] text-faint">© Dieter Balmer · Balmer Storm Solutions</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { if (handleRequestClose() !== false) onClose(); }}>
              {L('cancel', 'Abbrechen')}
            </Button>
            <Button variant="primary" onClick={handleSave}>
              {L('save', 'Speichern')}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-6">
          {/* Betrieb */}
          <section>
            <h4 className="mb-3 text-sm font-bold text-slate-700">{L('secBetrieb', 'Betrieb')}</h4>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>{L('firma', 'Firma')}</label>
                <input className={inputCls} value={draft.workshop.name} onChange={(e) => updateShop({ name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{L('strasse', 'Strasse')}</label>
                  <input className={inputCls} value={draft.workshop.strasse} onChange={(e) => updateShop({ strasse: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{L('plzOrt', 'PLZ / Ort')}</label>
                  <input className={inputCls} value={draft.workshop.plzOrt} onChange={(e) => updateShop({ plzOrt: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{L('telefon', 'Telefon')}</label>
                  <input className={inputCls} value={draft.workshop.telefon ?? ''} onChange={(e) => updateShop({ telefon: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{L('email', 'E-Mail')}</label>
                  <input className={inputCls} value={draft.workshop.email ?? ''} onChange={(e) => updateShop({ email: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>{L('website', 'Website')}</label>
                  <input className={inputCls} value={draft.workshop.website ?? ''} onChange={(e) => updateShop({ website: e.target.value })} />
                </div>
              </div>
              <div>
                <label className={labelCls}>{L('logo', 'Logo')}</label>
                <div className="flex items-center gap-3">
                  {draft.workshop.logoDataUrl && (
                    <img
                      src={draft.workshop.logoDataUrl}
                      alt="Logo"
                      // Mirror the print letterhead: max-height + generous max-width
                      // so the width scales with the aspect ratio, not a fixed cap.
                      style={{ maxHeight: draft.workshop.logoHeightPx ?? 34, maxWidth: 240 }}
                      className="object-contain rounded border border-slate-200"
                    />
                  )}
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {L('logoUpload', 'Logo wählen')}
                  </button>
                  {draft.workshop.logoDataUrl && (
                    <button
                      onClick={() => updateShop({ logoDataUrl: undefined })}
                      className="text-sm text-red-600 hover:underline"
                    >
                      {L('logoRemove', 'Entfernen')}
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                    className="hidden"
                    onChange={(e) => { void handleLogo(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </div>
                {draft.workshop.logoDataUrl && (
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                      {L('logoHeight', 'Logogrösse (Druck)')}
                    </label>
                    <input
                      type="range"
                      min={16}
                      max={90}
                      step={1}
                      value={draft.workshop.logoHeightPx ?? 34}
                      onChange={(e) => updateShop({ logoHeightPx: parseInt(e.target.value, 10) })}
                      className="flex-1 accent-blue-600"
                    />
                    <span className="w-12 text-right text-xs tabular-nums text-slate-600">
                      {draft.workshop.logoHeightPx ?? 34} px
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Nummerierung */}
          <section>
            <h4 className="mb-3 text-sm font-bold text-slate-700">{L('secNummerierung', 'Nummerierung')}</h4>
            <label className="flex items-center justify-between gap-3 mb-3">
              <span className="text-sm text-slate-700">{L('autoNumbers', 'Automatische Nummerierung')}</span>
              <input type="checkbox" checked={draft.autoJobNumbers} onChange={(e) => update({ autoJobNumbers: e.target.checked })} className="w-5 h-5" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{L('jobPrefix', 'Präfix')}</label>
                <input className={inputCls} value={draft.jobPrefix} onChange={(e) => update({ jobPrefix: e.target.value })} disabled={!draft.autoJobNumbers} />
              </div>
              <div>
                <label className={labelCls}>{L('jobNextNumber', 'Nächste Nr.')}</label>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={draft.jobNextNumber}
                  onChange={(e) => update({ jobNextNumber: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  disabled={!draft.autoJobNumbers}
                />
              </div>
            </div>
            {draft.autoJobNumbers && (
              <p className="mt-2 text-[11px] text-slate-400">
                {L('numberPreview', 'Nächste Karte')}: <span className="font-medium text-slate-600">{formatJobNumber(draft.jobPrefix, draft.jobNextNumber)}</span>
              </p>
            )}
          </section>

          {/* Scanner */}
          <section>
            <h4 className="mb-3 text-sm font-bold text-slate-700">{L('secScanner', 'Fahrzeugausweis-Scanner')}</h4>
            <label className="flex items-center justify-between gap-3 mb-3">
              <span className="text-sm text-slate-700">{L('scanEnable', 'Scanner aktivieren')}</span>
              <input type="checkbox" checked={draft.docScanEnabled} onChange={(e) => update({ docScanEnabled: e.target.checked })} className="w-5 h-5" />
            </label>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>{L('scanProvider', 'Anbieter')}</label>
                <select
                  value={draft.docScanProvider}
                  onChange={(e) => update({ docScanProvider: e.target.value as ScanProviderId })}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {PROVIDER_ORDER.map((p) => (
                    <option key={p} value={p}>{SCAN_PROVIDER_META[p].label} · {SCAN_PROVIDER_META[p].region}</option>
                  ))}
                </select>
                {meta.region === 'US' && (
                  <p className="mt-1 text-[11px] text-amber-600">{L('scanUsWarning', 'US-Anbieter: Das Bild verlässt die Schweiz/EU. Nur mit gültigem Vertrag (DPA).')}</p>
                )}
              </div>
              {meta.requiresAccountId && (
                <div>
                  <label className={labelCls}>{L('scanAccountId', 'Infomaniak Produkt-ID')}</label>
                  <input
                    className={inputCls}
                    value={draft.docScanProviderAccountId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      update({ docScanProviderAccountId: v });
                      // Auto-enable the scanner once ID + key are both present.
                      if (!draft.docScanEnabled && scanCredsComplete(apiKey, v, draft.docScanProvider)) {
                        update({ docScanEnabled: true });
                      }
                    }}
                    placeholder="z. B. 12345"
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>{L('scanApiKey', 'API-Schlüssel')}</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      const v = e.target.value;
                      setApiKey(v);
                      // Auto-enable the scanner once key (+ any required ID) is present.
                      if (!draft.docScanEnabled && scanCredsComplete(v, draft.docScanProviderAccountId, draft.docScanProvider)) {
                        update({ docScanEnabled: true });
                      }
                    }}
                    placeholder="••••••••••••"
                    autoComplete="off"
                    className={`${inputCls} pr-10`}
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{L('scanKeyStored', 'Der Schlüssel wird verschlüsselt auf diesem Gerät gespeichert.')}</p>
              </div>
              <div>
                <label className={labelCls}>{L('scanModel', 'Modell (optional)')}</label>
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputCls} flex-1`}
                    list="scan-model-options"
                    value={draft.docScanModel ?? ''}
                    onChange={(e) => update({ docScanModel: e.target.value.trim() })}
                    placeholder={SCAN_MODELS[draft.docScanProvider]}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void handleLoadModels()}
                    disabled={models.state === 'loading' || !apiKey.trim()}
                    icon={models.state === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  >
                    {L('scanModelLoad', 'Modelle laden')}
                  </Button>
                </div>
                {/* A datalist rather than a <select>: the catalogue is a
                    suggestion, not a constraint — a brand-new model id should
                    still be typeable the day it ships. */}
                <datalist id="scan-model-options">
                  {models.ids.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
                {models.state === 'error' ? (
                  <p className="mt-1 text-[11px] text-danger">{models.error}</p>
                ) : models.state === 'loaded' ? (
                  <p className="mt-1 text-[11px] text-muted">
                    {models.ids.length} {L('scanModelCount', 'Modelle verfügbar – ins Feld tippen oder auswählen.')}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-faint">
                    {L('scanModelHint', 'Leer lassen für das Standardmodell. Nur ändern, wenn der Anbieter das Modell abgeschaltet hat – es muss Bilder lesen können (Vision).')}
                  </p>
                )}
              </div>
              <label className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <input type="checkbox" checked={draft.docScanComplianceAck} onChange={(e) => update({ docScanComplianceAck: e.target.checked })} className="w-5 h-5 mt-0.5" />
                <span className="text-[12px] text-slate-600">
                  {L('scanAck', 'Ich bestätige, dass das Ausweisfoto inkl. Halterdaten zur Texterkennung an den gewählten Anbieter übermittelt wird und ein gültiger Auftragsverarbeitungsvertrag (DPA) besteht.')}{' '}
                  <a href={meta.dpaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline">DPA <ExternalLink size={11} /></a>
                </span>
              </label>
            </div>
          </section>

          {/* Datensicherung */}
          <section>
            <h4 className="mb-3 text-sm font-bold text-slate-700">{L('secBackup', 'Datensicherung')}</h4>
            <label className="flex items-center justify-between gap-3 mb-3">
              <span className="text-sm text-slate-700">{L('backupEnable', 'Automatische Sicherung')}</span>
              <input type="checkbox" checked={draft.backupEnabled} onChange={(e) => update({ backupEnabled: e.target.checked })} className="w-5 h-5" />
            </label>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>{L('backupFrequency', 'Häufigkeit')}</label>
                <select
                  value={draft.backupFrequency}
                  onChange={(e) => update({ backupFrequency: e.target.value as 'daily' | 'weekly' })}
                  disabled={!draft.backupEnabled}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value="daily">{L('backupDaily', 'Täglich')}</option>
                  <option value="weekly">{L('backupWeekly', 'Wöchentlich')}</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>{L('backupDir', 'Speicherort')}</label>
                {isElectron() ? (
                  <div className="flex items-center gap-2">
                    <input
                      className={`${inputCls} flex-1`}
                      value={draft.backupDir ?? ''}
                      readOnly
                      placeholder={L('backupDirNone', 'Kein Ordner gewählt')}
                    />
                    <button
                      onClick={() => void handlePickDir()}
                      className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <FolderOpen size={15} /> {L('backupPickDir', 'Verzeichnis wählen')}
                    </button>
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-500">
                    {isAndroid()
                      ? L('backupDirAndroid', 'Wird unter Dokumente/Arbeitskarte/backups gespeichert.')
                      : L('backupDirBrowser', 'Wird als Download gespeichert.')}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void handleBackupNow()}
                  disabled={busy !== null || (isElectron() && !draft.backupDir)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy === 'backup' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {L('backupNow', 'Jetzt sichern')}
                </button>
                <button
                  onClick={() => restoreInputRef.current?.click()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy === 'restore' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  {L('backupRestore', 'Wiederherstellen')}
                </button>
                {isElectron() && draft.backupDir && (
                  <button
                    onClick={() => void revealBackupFolder(draft.backupDir)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <FolderOpen size={15} /> {L('backupOpenFolder', 'Ordner öffnen')}
                  </button>
                )}
              </div>

              {backupMsg && (
                <p className={`text-[12px] break-all ${backupMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{backupMsg.text}</p>
              )}

              <p className="text-[11px] text-slate-400">
                {L('backupPrivacyNote', 'Die Sicherung ist eine unverschlüsselte JSON-Datei mit Halterdaten und Ausweisbildern – gleich schützenswert wie die App-Daten. Der Scanner-Schlüssel ist nicht enthalten.')}
              </p>

              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { handleRestoreFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>
          </section>
      </div>
    </Modal>
  );
}
