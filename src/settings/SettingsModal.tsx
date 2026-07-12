// ============================================================================
// SettingsModal — Betrieb (workshop identity) + Nummerierung + Scanner.
// The scanner API key is stored via the credential store, never in settings.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff, ExternalLink, FolderOpen, Download, Upload, Loader2 } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import type { AppSettings, ScanProviderId } from '../types/jobcard';
import { SCAN_PROVIDER_META } from '../scan/scanProviders';
import { getDocScanKey, setDocScanKey } from '../platform/credentialStore';
import { formatJobNumber } from '../numbering/jobNumber';
import { runBackup, LAST_BACKUP_KEY } from '../backup/runBackup';
import { pickBackupDir, revealBackupFolder } from '../backup/backupTarget';
import { parseBackup, restoreBackup, hasVersionMismatch } from '../backup/restoreBackup';
import { setMeta } from '../storage/jobCardRepository';
import { db } from '../storage/db';
import { isElectron, isAndroid } from '../platform/detect';

interface Props {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  /** Called after a successful restore so the parent can reload the card list. */
  onDataRestored?: () => void;
}

const PROVIDER_ORDER: ScanProviderId[] = ['infomaniak', 'mistral', 'openai', 'anthropic'];

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

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setApiKey(getDocScanKey());
    setShowKey(false);
    setBusy(null);
    setBackupMsg(null);
  }, [open, settings]);

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
      if (hasVersionMismatch(env)) {
        const proceedVer = window.confirm(
          `Diese Sicherung stammt aus einer anderen Datenbankversion (${env.dbVersion} statt ${db.verno}). ` +
          `Es kann zu Problemen kommen. Trotzdem wiederherstellen?`,
        );
        if (!proceedVer) return;
      }
      const proceed = window.confirm(
        `Sicherung vom ${new Date(env.exportedAt).toLocaleString('de-CH')} wiederherstellen?\n` +
        `${env.counts.jobcards} Karten, ${env.counts.blobs} Bilder.`,
      );
      if (!proceed) return;
      const replace = window.confirm(
        'Modus wählen:\n\n[OK] = Alle aktuellen Karten ersetzen\n[Abbrechen] = Zusammenführen (aktuelle Karten behalten)',
      );
      if (replace && !window.confirm('Wirklich ALLE aktuellen Karten und Bilder ersetzen? Kann nicht rückgängig gemacht werden.')) {
        return;
      }
      setBusy('restore');
      setBackupMsg(null);
      try {
        const res = await restoreBackup(env, replace ? 'replace' : 'merge');
        if (res.ok) {
          setBackupMsg({ ok: true, text: `${res.jobcards} Karten und ${res.blobs} Bilder wiederhergestellt.` });
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

  const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';
  const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">{L('settingsTitle', 'Einstellungen')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title={L('close', 'Schliessen')}>
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6">
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
                  <input className={inputCls} value={draft.docScanProviderAccountId ?? ''} onChange={(e) => update({ docScanProviderAccountId: e.target.value.trim() })} placeholder="z. B. 12345" />
                </div>
              )}
              <div>
                <label className={labelCls}>{L('scanApiKey', 'API-Schlüssel')}</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
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

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-100">
          <p className="text-[11px] text-slate-400">© Dieter Balmer · Balmer Storm Solutions</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium">{L('cancel', 'Abbrechen')}</button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">{L('save', 'Speichern')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
