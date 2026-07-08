import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, Printer, Search, Trash2, ChevronLeft } from 'lucide-react';
import { useLocale } from './i18n/locale';
import type { JobCardRecord, JobStatus } from './types/jobcard';
import {
  loadJobCardsList,
  saveJobCard,
  deleteJobCard,
  getJobCard,
  mintJobNumber,
  getSettings,
  newId,
} from './storage/jobCardRepository';
import { renderHtmlToPdfBytes, previewPdfBytes } from './print/printPdfBlob';
import { isElectron } from './platform/detect';

type View = { kind: 'list' } | { kind: 'edit'; id: string };

const STATUS_ORDER: JobStatus[] = ['offen', 'in_arbeit', 'erledigt', 'archiviert'];

function formatDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat('de-CH', { dateStyle: 'short', timeStyle: 'short' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export default function App() {
  const { t } = useLocale();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [cards, setCards] = useState<JobCardRecord[]>([]);
  const [query, setQuery] = useState('');
  const version = window.electronAPI?.appVersion ?? __APP_VERSION__;

  const reload = useCallback(async () => {
    setCards(await loadJobCardsList());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    const settings = await getSettings();
    const jobNumber = settings.autoJobNumbers ? await mintJobNumber() : '';
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
      const html = buildTestHtml();
      const bytes = await renderHtmlToPdfBytes(html, 'Arbeitskarte-Test.pdf');
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
            onDone={async () => {
              await reload();
              setView({ kind: 'list' });
            }}
          />
        )}
      </main>
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

function EditView({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useLocale();
  const [record, setRecord] = useState<JobCardRecord | null>(null);

  useEffect(() => {
    void getJobCard(id).then((r) => setRecord(r ?? null));
  }, [id]);

  if (!record) {
    return <div className="text-sm text-slate-500">…</div>;
  }

  const update = (patch: Partial<JobCardRecord>) => setRecord((r) => (r ? { ...r, ...patch } : r));

  const handleSave = async () => {
    await saveJobCard(record);
    onDone();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={onDone}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        <ChevronLeft size={16} /> {t.back}
      </button>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-5 text-base font-bold">
          {t.editCard} {record.jobNumber && <span className="text-slate-400">· {record.jobNumber}</span>}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.jobNumber}>
            <input
              value={record.jobNumber}
              onChange={(e) => update({ jobNumber: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </Field>
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
          <Field label={t.fieldName}>
            <input
              value={record.name ?? ''}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </Field>
          <Field label={t.fieldPlate}>
            <input
              value={record.kontrollschild ?? ''}
              onChange={(e) => update({ kontrollschild: e.target.value.toUpperCase() })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-blue-500"
            />
          </Field>
        </div>

        <p className="mt-4 text-xs text-slate-400">
          Phase 0 — Grundgerüst. Vollständiges Formular, Scanner, Fahrzeug-Grafik und Druck folgen
          in den nächsten Phasen.
        </p>

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
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
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
    <p>Diese Seite bestätigt, dass HTML → PDF (A4) im Hauptprozess läuft.</p>
  </div>
</body></html>`;
}
