// ============================================================================
// SettingsModal — Betrieb (workshop identity) + Nummerierung + Scanner.
// The scanner API key is stored via the credential store, never in settings.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import type { AppSettings, ScanProviderId } from '../types/jobcard';
import { SCAN_PROVIDER_META } from '../scan/scanProviders';
import { getDocScanKey, setDocScanKey } from '../platform/credentialStore';
import { formatJobNumber } from '../numbering/jobNumber';

interface Props {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
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

export default function SettingsModal({ open, settings, onSave, onClose }: Props) {
  const { t } = useLocale();
  const L = (key: string, fallback: string): string => (t as any)?.[key] || fallback;

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setApiKey(getDocScanKey());
    setShowKey(false);
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

  const handleSave = () => {
    setDocScanKey(apiKey.trim());
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
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] flex flex-col">
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
                    <img src={draft.workshop.logoDataUrl} alt="Logo" className="h-10 max-w-[120px] object-contain rounded border border-slate-200" />
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
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { void handleLogo(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </div>
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
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{L('scanRedactOwnerToggle', 'Halterblock vor dem Senden abdecken')}</span>
                <input type="checkbox" checked={draft.docScanRedactOwner} onChange={(e) => update({ docScanRedactOwner: e.target.checked })} className="w-5 h-5" />
              </label>
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium">{L('cancel', 'Abbrechen')}</button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">{L('save', 'Speichern')}</button>
        </div>
      </div>
    </div>
  );
}
