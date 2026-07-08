import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, Printer, Search, Trash2, ChevronLeft, Settings, ScanLine } from 'lucide-react';
import { useLocale } from './i18n/locale';
import type { JobCardRecord, JobStatus, AppSettings } from './types/jobcard';
import { DEFAULT_SETTINGS } from './types/jobcard';
import {
  loadJobCardsList,
  saveJobCard,
  deleteJobCard,
  getJobCard,
  mintJobNumber,
  getSettings,
  saveSettings,
  saveBlob,
  getBlob,
  deleteBlob,
  newId,
} from './storage/jobCardRepository';
import { renderHtmlToPdfBytes, previewPdfBytes } from './print/printPdfBlob';
import { isElectron } from './platform/detect';
import { SCAN_PROVIDER_META } from './scan/scanProviders';
import { getDocScanKey } from './platform/credentialStore';
import DocumentScanModal from './scan/DocumentScanModal';
import { applyScanToRecord } from './scan/applyScan';
import type { ScanResult } from './scan/documentScanner';
import { dataUrlToBlob } from './utils/dataUrl';
import ScanSettingsModal from './settings/ScanSettingsModal';
import CarMap from './carmap/CarMap';
import { regionLabel } from './carmap/regions';

type View = { kind: 'list' } | { kind: 'edit'; id: string };

const STATUS_ORDER: JobStatus[] = ['offen', 'in_arbeit', 'erledigt', 'archiviert'];

function formatDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat('de-CH', { dateStyle: 'short', timeStyle: 'short' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** True when the scanner is fully configured and safe to open. */
function isScanReady(settings: AppSettings): boolean {
  if (!settings.docScanEnabled || !settings.docScanComplianceAck) return false;
  if (!getDocScanKey().trim()) return false;
  const meta = SCAN_PROVIDER_META[settings.docScanProvider];
  if (meta.requiresAccountId && !(settings.docScanProviderAccountId || '').trim()) return false;
  return true;
}

export default function App() {
  const { t } = useLocale();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [cards, setCards] = useState<JobCardRecord[]>([]);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const version = window.electronAPI?.appVersion ?? __APP_VERSION__;

  const reload = useCallback(async () => {
    setCards(await loadJobCardsList());
  }, []);
  const reloadSettings = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    void reload();
    void reloadSettings();
  }, [reload, reloadSettings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.jobNumber, c.kontrollschild, c.vin, c.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [cards, query]);

  const handleNew = useCallback(async () => {
    const s = await getSettings();
    const jobNumber = s.autoJobNumbers ? await mintJobNumber() : '';
    const now = Date.now();
    const record: JobCardRecord = {
      id: newId(),
      jobNumber,
      status: 'offen',
      createdAt: now,
      updatedAt: now,
      damagedParts: [],
      photoIds: [],
    };
    await saveJobCard(record);
    await reload();
    setView({ kind: 'edit', id: record.id });
  }, [reload]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t.confirmDelete)) return;
      await deleteJobCard(id);
      await reload();
    },
    [reload, t.confirmDelete],
  );

  const handleTestPrint = useCallback(async () => {
    if (!isElectron()) {
      window.alert(t.testPrintOnlyDesktop);
      return;
    }
    try {
      const bytes = await renderHtmlToPdfBytes(buildTestHtml(), 'Arbeitskarte-Test.pdf');
      await previewPdfBytes(bytes, 'Arbeitskarte-Test.pdf');
    } catch (err) {
      window.alert(`${t.printFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [t.printFailed, t.testPrintOnlyDesktop]);

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">{t.appTitle}</h1>
          <span className="text-xs text-slate-400">v{version}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title={t.settings}
          >
            <Settings size={16} /> {t.settings}
          </button>
          <button
            onClick={handleTestPrint}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer size={16} /> {t.testPrint}
          </button>
          <button
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <FilePlus2 size={16} /> {t.newCard}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
        {view.kind === 'list' ? (
          <ListView
            cards={filtered}
            query={query}
            onQuery={setQuery}
            onOpen={(id) => setView({ kind: 'edit', id })}
            onDelete={handleDelete}
          />
        ) : (
          <EditView
            id={view.id}
            settings={settings}
            onOpenSettings={() => setSettingsOpen(true)}
            onDone={async () => {
              await reload();
              setView({ kind: 'list' });
            }}
          />
        )}
      </main>

      <ScanSettingsModal
        open={settingsOpen}
        settings={settings}
        onSave={async (s) => {
          await saveSettings(s);
          setSettings(s);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function ListView(props: {
  cards: JobCardRecord[];
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLocale();
  const { cards, query, onQuery, onOpen, onDelete } = props;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t.search}
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-500">
          {t.noCards}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t.colNumber}</th>
                <th className="px-4 py-2.5 font-semibold">{t.colName}</th>
                <th className="px-4 py-2.5 font-semibold">{t.colPlate}</th>
                <th className="px-4 py-2.5 font-semibold">{t.colStatus}</th>
                <th className="px-4 py-2.5 font-semibold">{t.colUpdated}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cards.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{c.jobNumber || '—'}</td>
                  <td className="px-4 py-2.5">{c.name || '—'}</td>
                  <td className="px-4 py-2.5">{c.kontrollschild || '—'}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatDate(c.updatedAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onOpen(c.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                      >
                        {t.open}
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title={t.delete}
                        aria-label={t.delete}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const { t } = useLocale();
  const styles: Record<JobStatus, string> = {
    offen: 'bg-amber-100 text-amber-800',
    in_arbeit: 'bg-blue-100 text-blue-800',
    erledigt: 'bg-emerald-100 text-emerald-800',
    archiviert: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {t[`status_${status}`]}
    </span>
  );
}

function EditView({
  id,
  settings,
  onOpenSettings,
  onDone,
}: {
  id: string;
  settings: AppSettings;
  onOpenSettings: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [record, setRecord] = useState<JobCardRecord | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [ausweisUrl, setAusweisUrl] = useState<string | null>(null);

  useEffect(() => {
    void getJobCard(id).then((r) => setRecord(r ?? null));
  }, [id]);

  // Load the stored Ausweis image (if any) into an object URL for the thumbnail.
  useEffect(() => {
    let url: string | null = null;
    const ausweisId = record?.ausweisImageId;
    if (!ausweisId) {
      setAusweisUrl(null);
      return;
    }
    void getBlob(ausweisId).then((b) => {
      if (b) {
        url = URL.createObjectURL(b.data);
        setAusweisUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [record?.ausweisImageId]);

  if (!record) {
    return <div className="text-sm text-slate-500">…</div>;
  }

  const update = (patch: Partial<JobCardRecord>) => setRecord((r) => (r ? { ...r, ...patch } : r));

  const handleSave = async () => {
    await saveJobCard(record);
    onDone();
  };

  const handleScanClick = () => {
    if (isScanReady(settings)) setScanOpen(true);
    else {
      window.alert(t.scanConfigureFirst);
      onOpenSettings();
    }
  };

  const handleScanApply = async (fields: ScanResult, originalImageDataUrl: string) => {
    let next = applyScanToRecord(record, fields);
    try {
      const blob = await dataUrlToBlob(originalImageDataUrl);
      if (record.ausweisImageId) await deleteBlob(record.ausweisImageId).catch(() => {});
      const blobId = newId();
      await saveBlob({
        id: blobId,
        jobcardId: record.id,
        sortOrder: -1,
        kind: 'ausweis',
        mime: blob.type || 'image/jpeg',
        data: blob,
        createdAt: Date.now(),
      });
      next = { ...next, ausweisImageId: blobId };
    } catch (err) {
      console.warn('[scan] Ausweisbild konnte nicht gespeichert werden:', err);
    }
    setRecord(next);
    await saveJobCard(next); // persist scanned fields + Ausweis link immediately
  };

  const selectedParts = new Set(record.damagedParts);
  const toggleDamage = (partId: string) => {
    const next = new Set(selectedParts);
    if (next.has(partId)) next.delete(partId);
    else next.add(partId);
    update({ damagedParts: Array.from(next) });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onDone}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={16} /> {t.back}
        </button>
        <button
          onClick={handleScanClick}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <ScanLine size={16} /> {t.scanAusweis}
        </button>
      </div>

      <div className="space-y-5">
        {/* Kopf */}
        <Section title={t.sectionKopf}>
          <TextField record={record} update={update} field="jobNumber" label={t.jobNumber} />
          <Field label={t.colStatus}>
            <select
              value={record.status}
              onChange={(e) => update({ status: e.target.value as JobStatus })}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {t[`status_${s}`]}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* Kunde / Halter */}
        <Section title={t.sectionKunde}>
          <TextField record={record} update={update} field="name" label={t.colName} />
          <TextField record={record} update={update} field="vorname" label={t.vorname} />
          <TextField record={record} update={update} field="strasse" label={t.strasse} />
          <TextField record={record} update={update} field="plzOrt" label={t.plzOrt} />
          <TextField record={record} update={update} field="telefon" label={t.telefon} />
        </Section>

        {/* Fahrzeug */}
        <Section title={t.sectionVehicle}>
          <TextField record={record} update={update} field="fahrzeugmarke" label={t.fahrzeugmarke} />
          <TextField record={record} update={update} field="fahrzeugtyp" label={t.fahrzeugtyp} />
          <TextField record={record} update={update} field="kontrollschild" label={t.kontrollschild} upper />
          <TextField record={record} update={update} field="vin" label={t.vin} upper />
          <TextField record={record} update={update} field="stammnummer" label={t.stammnummer} />
          <TextField record={record} update={update} field="farbe" label={t.farbe} />
          <TextField record={record} update={update} field="erstzulassung" label={t.erstzulassung} />
          <TextField record={record} update={update} field="versicherung" label={t.versicherung} />
        </Section>

        {/* Schaden — car map */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.sectionSchaden}</h2>
            <span className="text-xs text-slate-400">{t.schadenHint}</span>
          </div>
          <div className="mx-auto max-w-xs">
            <CarMap selected={selectedParts} onToggle={toggleDamage} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {record.damagedParts.length === 0 ? (
              <span className="text-xs text-slate-400">{t.noDamageSelected}</span>
            ) : (
              record.damagedParts.map((partId) => (
                <button
                  key={partId}
                  onClick={() => toggleDamage(partId)}
                  className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                  title={t.delete}
                >
                  {regionLabel(partId)} ✕
                </button>
              ))
            )}
          </div>
          <div className="mt-4">
            <Field label={t.schadenNotiz}>
              <textarea
                value={record.schadenNotiz ?? ''}
                onChange={(e) => update({ schadenNotiz: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </Field>
          </div>
        </div>

        {/* Ausweis thumbnail */}
        {ausweisUrl && (
          <Section title={t.ausweisFoto}>
            <div className="sm:col-span-2">
              <img
                src={ausweisUrl}
                alt={t.ausweisFoto}
                className="max-h-64 rounded-lg border border-slate-200 object-contain"
              />
            </div>
          </Section>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onDone}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t.cancel}
        </button>
        <button
          onClick={handleSave}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {t.save}
        </button>
      </div>

      <DocumentScanModal
        open={scanOpen}
        provider={settings.docScanProvider}
        apiKey={getDocScanKey()}
        accountId={settings.docScanProviderAccountId}
        country="CH"
        redactOwner={settings.docScanRedactOwner}
        onApply={(fields, original) => void handleScanApply(fields, original)}
        onClose={() => setScanOpen(false)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/** Text input bound to a string field of the record. */
function TextField({
  record,
  update,
  field,
  label,
  upper,
}: {
  record: JobCardRecord;
  update: (patch: Partial<JobCardRecord>) => void;
  field: keyof JobCardRecord;
  label: string;
  upper?: boolean;
}) {
  const value = (record[field] as string | undefined) ?? '';
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(e) =>
          update({ [field]: upper ? e.target.value.toUpperCase() : e.target.value } as Partial<JobCardRecord>)
        }
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 ${upper ? 'uppercase' : ''}`}
      />
    </Field>
  );
}

function buildTestHtml(): string {
  const now = new Intl.DateTimeFormat('de-CH', { dateStyle: 'full', timeStyle: 'short' }).format(Date.now());
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: system-ui, "Segoe UI", sans-serif; color: #0f172a; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  .sub { color: #64748b; margin-bottom: 24px; }
  .box { border: 2px solid #2563eb; border-radius: 8px; padding: 24px; }
</style></head>
<body>
  <div class="box">
    <h1>Arbeitskarte — Test-Druck</h1>
    <div class="sub">printToPDF-Rundlauf funktioniert.</div>
    <p>Erzeugt: ${now}</p>
  </div>
</body></html>`;
}
