// ============================================================================
// ScanSettingsModal — configure the document scanner (BYO key, provider,
// compliance acknowledgement, optional owner-block redaction).
// The API key is stored via the credential store, never in settings/localStorage.
// ============================================================================

import { useEffect, useState } from 'react';
import { X, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { useLocale } from '../i18n/locale';
import type { AppSettings, ScanProviderId } from '../types/jobcard';
import { SCAN_PROVIDER_META } from '../scan/scanProviders';
import { getDocScanKey, setDocScanKey } from '../platform/credentialStore';

interface Props {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const PROVIDER_ORDER: ScanProviderId[] = ['infomaniak', 'mistral', 'openai', 'anthropic'];

export default function ScanSettingsModal({ open, settings, onSave, onClose }: Props) {
  const { t } = useLocale();
  const L = (key: string, fallback: string): string => (t as any)?.[key] || fallback;

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setApiKey(getDocScanKey());
    setShowKey(false);
  }, [open, settings]);

  if (!open) return null;

  const meta = SCAN_PROVIDER_META[draft.docScanProvider];
  const update = (patch: Partial<AppSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = () => {
    setDocScanKey(apiKey.trim());
    onSave(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">{L('scanSettingsTitle', 'Scanner-Einstellungen')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title={L('close', 'Schliessen')}>
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Enable */}
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">{L('scanEnable', 'Fahrzeugausweis-Scanner aktivieren')}</span>
            <input
              type="checkbox"
              checked={draft.docScanEnabled}
              onChange={(e) => update({ docScanEnabled: e.target.checked })}
              className="w-5 h-5"
            />
          </label>

          {/* Provider */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              {L('scanProvider', 'Anbieter (Texterkennung)')}
            </label>
            <select
              value={draft.docScanProvider}
              onChange={(e) => update({ docScanProvider: e.target.value as ScanProviderId })}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {PROVIDER_ORDER.map((p) => (
                <option key={p} value={p}>
                  {SCAN_PROVIDER_META[p].label} · {SCAN_PROVIDER_META[p].region}
                </option>
              ))}
            </select>
            {meta.region === 'US' && (
              <p className="mt-1 text-[11px] text-amber-600">
                {L('scanUsWarning', 'US-Anbieter: Das Bild verlässt die Schweiz/EU. Nur mit gültigem Vertrag (DPA) verwenden.')}
              </p>
            )}
          </div>

          {/* Infomaniak Produkt-ID */}
          {meta.requiresAccountId && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                {L('scanAccountId', 'Infomaniak Produkt-ID')}
              </label>
              <input
                type="text"
                value={draft.docScanProviderAccountId ?? ''}
                onChange={(e) => update({ docScanProviderAccountId: e.target.value.trim() })}
                placeholder="z. B. 12345"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* API key */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              {L('scanApiKey', 'API-Schlüssel')}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title={showKey ? L('hide', 'Verbergen') : L('show', 'Anzeigen')}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {L('scanKeyStored', 'Der Schlüssel wird verschlüsselt auf diesem Gerät gespeichert (nicht in den Einstellungen).')}
            </p>
          </div>

          {/* Compliance ack */}
          <label className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <input
              type="checkbox"
              checked={draft.docScanComplianceAck}
              onChange={(e) => update({ docScanComplianceAck: e.target.checked })}
              className="w-5 h-5 mt-0.5"
            />
            <span className="text-[12px] text-slate-600">
              {L('scanAck', 'Ich bestätige, dass das Ausweisfoto inkl. Halterdaten zur Texterkennung an den gewählten Anbieter übermittelt wird und ein gültiger Auftragsverarbeitungsvertrag (DPA) besteht.')}{' '}
              <a href={meta.dpaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline">
                DPA <ExternalLink size={11} />
              </a>
            </span>
          </label>

          {/* Redact owner */}
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-700">{L('scanRedactOwnerToggle', 'Halterblock vor dem Senden abdecken')}</span>
            <input
              type="checkbox"
              checked={draft.docScanRedactOwner}
              onChange={(e) => update({ docScanRedactOwner: e.target.checked })}
              className="w-5 h-5"
            />
          </label>
          <p className="-mt-3 text-[11px] text-slate-400">
            {L('scanRedactOwnerHint', 'Standard: aus — die Halterdaten sollen ja erfasst werden.')}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium">
            {L('cancel', 'Abbrechen')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {L('save', 'Speichern')}
          </button>
        </div>
      </div>
    </div>
  );
}
