import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, Printer, Search, Trash2, ChevronLeft, Settings, ScanLine, Camera, ImagePlus, X, Eye, Undo2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useLocale } from './i18n/locale';
import type { JobCardRecord, JobStatus, AppSettings, WorkshopIdentity, DamageStroke } from './types/jobcard';
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
  getBlobs,
  deleteBlob,
  newId,
} from './storage/jobCardRepository';
import { printJobCard, previewJobCard } from './print/printPdfBlob';
import { buildJobCardHtml } from './print/JobCardDocument';
import { blobToDataUrl } from './utils/dataUrl';
import { SCAN_PROVIDER_META } from './scan/scanProviders';
import { getDocScanKey } from './platform/credentialStore';
import DocumentScanModal from './scan/DocumentScanModal';
import { applyScanToRecord } from './scan/applyScan';
import type { ScanResult } from './scan/documentScanner';
import { dataUrlToBlob } from './utils/dataUrl';
import SettingsModal from './settings/SettingsModal';
import { maybeRunAutoBackup } from './backup/runBackup';
import CarMap from './carmap/CarMap';
import { panelLabel, panelCategory, type PanelCategory } from './carmap/panels';
import CameraCaptureModal from './capture/CameraCaptureModal';
import { compressImage } from './capture/compressImage';
import { MAX_PHOTOS_PER_JOB } from './capture/photoLimits';
import DateField from './components/DateField';
import { Section, Field, TextField, TextAreaField, CheckField, inputClass } from './ui/form';
import { useAutosave } from './storage/useAutosave';
import { useAndroidBackHandler } from './platform/androidBackHandler';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { Modal } from './ui/Modal';
import { Button, IconButton } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

type View = { kind: 'list' } | { kind: 'edit'; id: string; draft?: JobCardRecord };

const STATUS_ORDER: JobStatus[] = ['offen', 'in_arbeit', 'erledigt', 'archiviert'];

// Chip colour per panel category — mirrors the FlatCarMap2 selected-fill scheme
// (body/wheels/bumpers/other + rear lights red, glass + indicators orange,
// front lights yellow) so chips read the same as the map.
const CHIP_CLASSES: Record<PanelCategory, string> = {
  body: 'bg-red-100 text-red-700 hover:bg-red-200',
  'light-rear': 'bg-red-100 text-red-700 hover:bg-red-200',
  glass: 'bg-orange-100 text-orange-700 hover:bg-orange-200',
  'light-indicator': 'bg-orange-100 text-orange-700 hover:bg-orange-200',
  'light-front': 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
};

/** One-line identity of a card for dialogs and toasts — number, plate, customer.
 *  Anything the shop would use to recognise it on the bench. */
function describeCard(c: JobCardRecord): string {
  const who = String(c.firma || '').trim() || [c.vorname, c.name].filter(Boolean).join(' ').trim();
  return [c.jobNumber ? `Nr. ${c.jobNumber}` : '', c.kontrollschild, who].filter(Boolean).join(' · ');
}

function formatDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat('de-CH', { dateStyle: 'short', timeStyle: 'short' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Load a card's photos and render its self-contained A4 print/preview HTML. */
async function renderCardHtml(record: JobCardRecord, workshop: WorkshopIdentity): Promise<string> {
  const bs = await getBlobs(record.id);
  const photos = bs.filter((b) => b.kind === 'photo').sort((a, b) => a.sortOrder - b.sortOrder);
  const photoDataUrls = await Promise.all(photos.map((p) => blobToDataUrl(p.data)));
  const ausweis = bs.find((b) => b.kind === 'ausweis');
  const ausweisDataUrl = ausweis ? await blobToDataUrl(ausweis.data) : undefined;
  return buildJobCardHtml({
    record,
    workshop,
    photoDataUrls,
    ausweisDataUrl,
    createdLabel: formatDate(record.createdAt),
  });
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
  const toast = useToast();
  const { confirm } = useConfirm();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [cards, setCards] = useState<JobCardRecord[]>([]);
  // Lives here, not in ListView, so returning from the editor doesn't silently
  // throw away the search and filters the user was working with.
  const [listState, setListState] = useState<ListState>({
    query: '',
    statusFilter: 'alle',
    sortField: 'date',
    sortDir: 'desc',
  });
  const query = listState.query;
  const patchListState = useCallback(
    (patch: Partial<ListState>) => setListState((s) => ({ ...s, ...patch })),
    [],
  );
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<{ html: string; filename: string } | null>(null);
  const version = window.electronAPI?.appVersion ?? __APP_VERSION__;
  /** Drives the header's hairline: a permanent border draws a box around a page
   *  that isn't scrolled; a line that appears on scroll reads as depth. */
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const reload = useCallback(async () => {
    setCards(await loadJobCardsList());
  }, []);
  const reloadSettings = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    void reload();
    void reloadSettings();
    // Launch auto-backup (fire-and-forget; never throws). Fetch settings directly
    // since setSettings is async and state isn't populated yet on first mount.
    void getSettings().then((s) => maybeRunAutoBackup(s));
  }, [reload, reloadSettings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.jobNumber, c.kontrollschild, c.vin, c.name, c.vorname, c.firma]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [cards, query]);

  const handleNew = useCallback(async () => {
    const now = Date.now();
    // Build a DRAFT — the editor autosaves it as soon as anything is typed, and
    // discards it again on exit if nothing was. The Auftrags-Nr. IS minted right
    // here though (shop request: the number must be visible the moment the card
    // opens, e.g. to label the physical folder). Like the paper pad, a discarded
    // card therefore consumes its number (counter gap).
    const record: JobCardRecord = {
      id: newId(),
      jobNumber: '',
      status: 'offen',
      createdAt: now,
      updatedAt: now,
      damagedParts: [],
      damageStrokes: [],
      photoIds: [],
    };
    if (settings.autoJobNumbers) {
      try {
        record.jobNumber = await mintJobNumber();
      } catch {
        /* leave empty — Speichern mints as fallback */
      }
    }
    setView({ kind: 'edit', id: record.id, draft: record });
  }, [settings.autoJobNumbers]);

  const handleDelete = useCallback(
    async (id: string) => {
      // Name the card being deleted. The old prompt ("Diese Arbeitskarte
      // wirklich löschen?") gave no way to tell whether the right row was hit.
      const card = cards.find((c) => c.id === id);
      const ok = await confirm({
        title: t.confirmDeleteTitle,
        message: (
          <>
            <p className="font-semibold text-ink">{card ? describeCard(card) : ''}</p>
            <p className="mt-2 text-muted">{t.confirmDeleteBody}</p>
          </>
        ),
        confirmLabel: t.delete,
        confirmVariant: 'danger',
      });
      if (!ok) return;
      await deleteJobCard(id);
      await reload();
      toast.success(t.cardDeleted);
    },
    [cards, confirm, reload, toast, t],
  );

  const handleStatusChange = useCallback(async (id: string, status: JobStatus) => {
    try {
      const card = await getJobCard(id);
      if (!card) return;
      await saveJobCard({ ...card, status });
      // Optimistic in-place update — keep the row where it is (no reload/jump).
      // Bump updatedAt to match what saveJobCard persisted, so "Geändert" is truthful.
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status, updatedAt: Date.now() } : c)));
    } catch (err) {
      console.warn('[status] change failed, resyncing:', err);
      await reload(); // revert the UI to the persisted truth
    }
  }, [reload]);

  // Eye icon — fast in-app HTML preview (no PDF engine round-trip).
  const handlePreview = useCallback(async (id: string) => {
    const card = await getJobCard(id);
    if (!card) return;
    try {
      const s = await getSettings();
      const html = await renderCardHtml(card, s.workshop);
      const nr = card.jobNumber || card.id.slice(0, 6);
      setPreview({ html, filename: `Arbeitskarte-${nr}.pdf` });
    } catch (err) {
      toast.error(`${t.printFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [t.printFailed, toast]);

  // Printer icon — render to PDF bytes and open the native print preview.
  const handlePrintPreview = useCallback(async (id: string) => {
    const card = await getJobCard(id);
    if (!card) return;
    try {
      const s = await getSettings();
      const html = await renderCardHtml(card, s.workshop);
      const nr = card.jobNumber || card.id.slice(0, 6);
      await previewJobCard(html, `Arbeitskarte-${nr}.pdf`);
    } catch (err) {
      toast.error(`${t.printFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [t.printFailed, toast]);

  return (
    // paddingBottom clears the Android navigation bar (edge-to-edge WebView on
    // targetSdk 36) so the last row isn't hidden behind it. The gradient picks up
    // the boot splash's colours (index.html) so app and splash read as one thing.
    <div
      className="min-h-full bg-gradient-to-b from-surface to-accent-soft/40 text-ink"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <header
        className={`sticky top-0 z-[var(--z-sticky)] bg-paper/85 backdrop-blur transition-shadow ${
          scrolled ? 'border-b border-line shadow-elev-card' : 'border-b border-transparent'
        }`}
      >
        {/* Extra top padding = status-bar inset, so the title clears the Android
            status bar (clock/battery) instead of sitting underneath it. */}
        <div
          className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        >
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-bold tracking-tight">{t.appTitle}</h1>
            <span className="text-[11px] font-medium text-faint">v{version}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={handleNew} icon={<FilePlus2 size={16} />}>
              {t.newCard}
            </Button>
            <Button variant="secondary" onClick={() => setSettingsOpen(true)} icon={<Settings size={16} />} title={t.settings}>
              {t.settings}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {view.kind === 'list' ? (
          <ListView
            cards={filtered}
            totalCount={cards.length}
            state={listState}
            onState={patchListState}
            onNew={() => void handleNew()}
            onOpen={(id) => setView({ kind: 'edit', id })}
            onDelete={handleDelete}
            onPreview={handlePreview}
            onPrintPreview={handlePrintPreview}
            onStatusChange={handleStatusChange}
          />
        ) : (
          <EditView
            id={view.id}
            draft={view.draft}
            settings={settings}
            onOpenSettings={() => setSettingsOpen(true)}
            onDone={async () => {
              await reload();
              setView({ kind: 'list' });
            }}
          />
        )}

        {/* Footer only on the list — the editor stays dense. */}
        {view.kind === 'list' && (
          <footer className="mt-10 pb-6 text-center text-xs text-faint">{t.footerCredit}</footer>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onSave={async (s) => {
          await saveSettings(s);
          setSettings(s);
        }}
        onDataRestored={() => { void reload(); }}
        onClose={() => setSettingsOpen(false)}
      />

      {preview && (
        <PreviewModal
          html={preview.html}
          onPrint={() => void previewJobCard(preview.html, preview.filename)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

/** In-app HTML preview of the print layout. Renders the same self-contained
 *  print HTML in a sandboxed iframe (fast — no PDF round-trip). The Printer
 *  button opens the real PDF print preview. */
function PreviewModal({ html, onPrint, onClose }: { html: string; onPrint: () => void; onClose: () => void }) {
  const { t } = useLocale();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-black/50 p-4"
      style={{
        paddingTop: 'calc(1rem + env(safe-area-inset-top))',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
      }}
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-card bg-paper shadow-elev-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{t.preview}</h2>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={onPrint} icon={<Printer size={16} />}>
              {t.printCard}
            </Button>
            <IconButton aria-label={t.close} title={t.close} onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-surface-sunken p-4">
          <iframe
            title={t.preview}
            // Inject screen-only page padding — the print HTML uses `body{margin:0}`
            // and relies on @page margins that don't apply on screen, so without
            // this the preview content would sit edge-to-edge. Only affects the
            // in-app iframe; the real PDF path (printToPDF) is unchanged.
            srcDoc={html.replace(
              '</head>',
              // Static preview: page padding + kill SVG pointer events so the
              // car map's :hover fills can't trigger while mousing over it.
              '<style>@media screen{body{padding:14mm}}svg *{pointer-events:none!important}</style></head>',
            )}
            className="mx-auto block h-full w-full max-w-[210mm] rounded bg-white shadow"
          />
        </div>
      </div>
    </div>
  );
}

/** Search, status filter and sort order live in App, not here, so that opening
 *  a card and coming back doesn't silently reset what the user was looking at. */
export interface ListState {
  query: string;
  statusFilter: JobStatus | 'alle';
  sortField: 'nr' | 'date';
  sortDir: 'asc' | 'desc';
}

function ListView(props: {
  cards: JobCardRecord[];
  /** Cards before the query filter — for the "x von y" hit count. */
  totalCount: number;
  state: ListState;
  onState: (patch: Partial<ListState>) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onPreview: (id: string) => void;
  onPrintPreview: (id: string) => void;
  onStatusChange: (id: string, status: JobStatus) => void;
}) {
  const { t } = useLocale();
  const { cards, totalCount, state, onState, onNew, onOpen, onDelete, onPreview, onPrintPreview, onStatusChange } = props;
  const { query, statusFilter, sortField, sortDir } = state;

  // Click a sortable header: toggle direction if it's the active column,
  // otherwise switch to it with a sensible default (dates newest-first).
  const toggleSort = (field: 'nr' | 'date') => {
    if (sortField === field) onState({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    else onState({ sortField: field, sortDir: field === 'date' ? 'desc' : 'asc' });
  };

  const visible = useMemo(() => {
    const rows = statusFilter === 'alle' ? cards : cards.filter((c) => c.status === statusFilter);
    const sorted = [...rows].sort((a, b) => {
      const cmp =
        sortField === 'nr'
          ? // Empty numbers sort last; otherwise natural (numeric-aware) order.
            (a.jobNumber || '￿').localeCompare(b.jobNumber || '￿', 'de', { numeric: true })
          : a.updatedAt - b.updatedAt;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [cards, statusFilter, sortField, sortDir]);

  const filtersActive = query.trim() !== '' || statusFilter !== 'alle';
  const resetFilters = () => onState({ query: '', statusFilter: 'alle' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => onState({ query: e.target.value })}
            placeholder={t.search}
            className={`${inputClass} ui-control pl-9 ${query ? 'pr-10' : ''}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => onState({ query: '' })}
              aria-label={t.clearSearch}
              title={t.clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control p-1.5 text-faint hover:bg-surface-sunken hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => onState({ statusFilter: e.target.value as JobStatus | 'alle' })}
          title={t.filterStatus}
          aria-label={t.filterStatus}
          className={`${inputClass} ui-control w-auto`}
        >
          <option value="alle">{t.filterStatus}: {t.filterAll}</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {t.filterStatus}: {t[`status_${s}`]}
            </option>
          ))}
        </select>
      </div>

      {/* Hit count only while a filter is on — "128 von 128" is noise. */}
      {filtersActive && totalCount > 0 && (
        <p className="mb-2 text-xs text-muted">
          {visible.length} {t.countOfTotal} {totalCount}
        </p>
      )}

      {totalCount === 0 ? (
        <div className="rounded-card border border-line bg-paper shadow-elev-card">
          <EmptyState
            icon={<FilePlus2 size={30} />}
            title={t.emptyNoCards}
            hint={t.emptyNoCardsHint}
            action={<Button variant="primary" onClick={onNew} icon={<FilePlus2 size={16} />}>{t.newCard}</Button>}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-card border border-line bg-paper shadow-elev-card">
          <EmptyState
            icon={<Search size={30} />}
            title={t.emptyNoMatch}
            hint={t.emptyNoMatchHint}
            action={<Button variant="secondary" onClick={resetFilters}>{t.resetFilters}</Button>}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-paper shadow-elev-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <SortHeader
                  label={t.colNumber}
                  active={sortField === 'nr'}
                  dir={sortDir}
                  onClick={() => toggleSort('nr')}
                />
                <th className="px-4 py-2 font-semibold">{t.colName}</th>
                <th className="hidden px-4 py-2 font-semibold sm:table-cell">{t.colPlate}</th>
                <th className="px-4 py-2 font-semibold">{t.colStatus}</th>
                <SortHeader
                  label={t.colUpdated}
                  active={sortField === 'date'}
                  dir={sortDir}
                  onClick={() => toggleSort('date')}
                />
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((c) => (
                // The WHOLE row opens the card. The old "Bearbeiten" text link was
                // a ~50x20px target on a tablet, next to three icons that looked
                // equally tappable but did other things.
                <tr
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(c.id);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`${t.open}: ${describeCard(c)}`}
                  className="cursor-pointer outline-none transition-colors hover:bg-accent-soft/50 focus-visible:bg-accent-soft"
                >
                  {/* py-1, not py-2.5: the 44px touch controls (status pill, icon
                      buttons) already set the row height — padding on top of that
                      only costs list density. */}
                  <td className="px-4 py-1 font-semibold">{c.jobNumber || '—'}</td>
                  <td className="px-4 py-1">{c.name || c.vorname || c.firma || '—'}</td>
                  <td className="hidden px-4 py-1 sm:table-cell">{c.kontrollschild || '—'}</td>
                  <td className="px-4 py-1">
                    <StatusSelect status={c.status} onChange={(s) => onStatusChange(c.id, s)} />
                  </td>
                  <td className="px-4 py-1 text-muted">{formatDate(c.updatedAt)}</td>
                  <td className="px-4 py-1 text-right">
                    {/* Different weights so the eye and the printer stop reading as
                        two interchangeable icons. */}
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton variant="ghost" onClick={() => onPreview(c.id)} title={t.preview} aria-label={t.preview}>
                        <Eye size={18} />
                      </IconButton>
                      <IconButton variant="secondary" onClick={() => onPrintPreview(c.id)} title={t.printPreview} aria-label={t.printPreview}>
                        <Printer size={18} />
                      </IconButton>
                      <IconButton variant="ghostDanger" onClick={() => onDelete(c.id)} title={t.delete} aria-label={t.delete}>
                        <Trash2 size={18} />
                      </IconButton>
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

/** A clickable column header that sorts the list — shows an up/down caret when
 *  active, and a faint neutral caret otherwise (the affordance to click). */
function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2 font-semibold">
      <button
        type="button"
        onClick={onClick}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${
          active ? 'text-ink' : ''
        }`}
      >
        {label}
        {active ? (
          dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
        ) : (
          <ChevronsUpDown size={13} className="text-faint" />
        )}
      </button>
    </th>
  );
}

/** Inline status dropdown — lets the user reassign a card's status from the list. */
function StatusSelect({ status, onChange }: { status: JobStatus; onChange: (s: JobStatus) => void }) {
  const { t } = useLocale();
  const styles: Record<JobStatus, string> = {
    offen: 'bg-amber-100 text-amber-800 border-amber-200',
    in_arbeit: 'bg-blue-100 text-blue-800 border-blue-200',
    erledigt: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    archiviert: 'bg-slate-200 text-slate-600 border-slate-300',
  };
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as JobStatus)}
      onClick={(e) => e.stopPropagation()}
      title={t.colStatus}
      aria-label={t.colStatus}
      className={`ui-control cursor-pointer rounded-full border pl-2.5 pr-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-accent/25 ${styles[status]}`}
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s} className="bg-paper text-ink">
          {t[`status_${s}`]}
        </option>
      ))}
    </select>
  );
}

function EditView({
  id,
  draft,
  settings,
  onOpenSettings,
  onDone,
}: {
  id: string;
  /** A new, not-yet-persisted card. When present the editor starts from it
   *  instead of loading `id` from the DB (which wouldn't exist yet). */
  draft?: JobCardRecord;
  settings: AppSettings;
  onOpenSettings: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [record, setRecord] = useState<JobCardRecord | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [photoCamOpen, setPhotoCamOpen] = useState(false);
  const [ausweisUrl, setAusweisUrl] = useState<string | null>(null);
  const [photoThumbs, setPhotoThumbs] = useState<{ id: string; url: string }[]>([]);
  const [mapMode, setMapMode] = useState<'select' | 'draw'>('select');
  /** Damage actions in order, so Rückgängig works for panel taps as well as
   *  strokes. A ref, not state: undo never needs to trigger a render itself. */
  const actionStack = useRef<Array<{ kind: 'stroke' } | { kind: 'panel'; id: string }>>([]);
  /** Which image the lightbox is showing (thumbnails are too small to check a
   *  scan against on a tablet). */
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
  /** The card as it was when the editor opened — the target of "Änderungen
   *  verwerfen", which replaces the old Abbrechen button. */
  const originalRef = useRef<JobCardRecord | null>(null);
  /** True for a card created in this editor session; "verwerfen" then means
   *  "throw the whole card away", not "revert the fields". */
  const isNewRef = useRef(Boolean(draft));

  const autosave = useAutosave(record, saveJobCard, { delay: 700 });

  // Android hardware back inside the editor used to fall through to the platform
  // default: the app exited and the unsaved draft went with it. Registered via a
  // ref because the handler needs `record`, which is only known past the loading
  // guard below — hooks have to run unconditionally.
  const leaveRef = useRef<() => void>(() => {});
  useAndroidBackHandler(() => leaveRef.current(), !lightbox && !scanOpen && !photoCamOpen);

  /** The single write path. Every mutation goes through here — setState AND the
   *  persist, with the value passed explicitly so nothing races the debounce. */
  const commit = useCallback(
    async (next: JobCardRecord) => {
      setRecord(next);
      await autosave.flush(next);
    },
    [autosave],
  );

  useEffect(() => {
    if (draft) {
      setRecord(draft); // new card — start from the in-memory draft, no DB read
      originalRef.current = draft;
      return;
    }
    void getJobCard(id).then((r) => {
      setRecord(r ?? null);
      originalRef.current = r ?? null;
    });
  }, [id, draft]);

  // Fallback mint. The number is normally assigned when the card is opened
  // (handleNew); this covers the case where that failed, or auto-numbering was
  // switched on after the draft was created. It used to live in handleSave,
  // which no longer exists.
  const minted = useRef(false);
  useEffect(() => {
    if (minted.current || !record) return;
    if (!settings.autoJobNumbers || record.jobNumber.trim()) return;
    minted.current = true;
    void mintJobNumber().then((nr) => setRecord((r) => (r && !r.jobNumber.trim() ? { ...r, jobNumber: nr } : r)));
  }, [record, settings.autoJobNumbers]);

  // Load additional photo thumbnails whenever the photo set changes.
  const photoKey = (record?.photoIds ?? []).join(',');
  useEffect(() => {
    if (!record) return;
    const jobId = record.id;
    let cancelled = false;
    const urls: string[] = [];
    void getBlobs(jobId).then((bs) => {
      if (cancelled) return;
      const thumbs = bs
        .filter((b) => b.kind === 'photo')
        .map((b) => {
          const u = URL.createObjectURL(b.data);
          urls.push(u);
          return { id: b.id, url: u };
        });
      setPhotoThumbs(thumbs);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, photoKey]);

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

  /** Everything the user can actually put into a card. Explicitly a positive
   *  list: jobNumber/status/createdAt are populated before the user types a
   *  single character, so "is this record empty?" cannot be asked of the whole
   *  object. */
  const hasContent = (r: JobCardRecord): boolean => {
    const texts: (string | undefined)[] = [
      r.repDatum, r.abholdatum, r.schluesselCode, r.ersatzwagenKopf,
      r.firma, r.vorname, r.name, r.strasse, r.plzOrt, r.telefon, r.telefon2, r.kundeNotiz,
      r.fahrzeugmarke, r.fahrzeugtyp, r.kontrollschild, r.vin, r.stammnummer, r.farbe,
      r.erstzulassung, r.kilometerstand, r.versicherung, r.schadenNr, r.schadenNotiz,
      r.spenglerarbeit, r.ersatzteileKleinmat, r.lackierarbeit, r.lackmaterial, r.kittsatz,
      r.nebenarbeiten, r.schneidfaden, r.arbeitenErsatzwagen, r.notes,
    ];
    if (texts.some((v) => (v ?? '').trim() !== '')) return true;
    if (r.automat) return true;
    if (r.damagedParts.length > 0) return true;
    if ((r.damageStrokes ?? []).length > 0) return true;
    if (r.photoIds.length > 0) return true;
    if (r.ausweisImageId) return true;
    return false;
  };

  /** Leave the editor. Empty brand-new cards are removed instead of persisted,
   *  so a mistaken tap on "Neue Karte" doesn't leave a ghost row in the list.
   *  cancel() MUST come before the delete: Dexie put is an upsert, so a pending
   *  debounce would otherwise write the row straight back. */
  const leaveEditor = async () => {
    if (isNewRef.current && !hasContent(record)) {
      autosave.cancel();
      await deleteJobCard(record.id).catch(() => {});
      onDone();
      return;
    }
    await autosave.flush();
    onDone();
  };
  leaveRef.current = () => { void leaveEditor(); };

  /** Replaces the old Abbrechen. Reverts the text fields to the state the card
   *  was in when the editor opened. Photos and the Ausweis image are NOT
   *  reverted — they were already written the moment they were added, exactly
   *  as under the old Abbrechen button. */
  const handleDiscard = async () => {
    const original = originalRef.current;
    if (isNewRef.current) {
      const ok = await confirm({
        title: t.discardCardTitle,
        message: t.discardCardBody,
        confirmLabel: t.discardConfirm,
        confirmVariant: 'danger',
      });
      if (!ok) return;
      autosave.cancel();
      await deleteJobCard(record.id).catch(() => {});
      onDone();
      return;
    }
    if (!original) return;
    const ok = await confirm({
      title: t.discardTitle,
      message: t.discardEditsBody,
      confirmLabel: t.discardConfirm,
      cancelLabel: t.keepEditing,
      confirmVariant: 'danger',
    });
    if (!ok) return;
    autosave.cancel();
    await commit(original);
    toast.success(t.discardDone);
  };

  const handleScanClick = () => {
    // Offline OCR needs no key/ack, so the scanner opens as soon as the feature
    // is switched on; the cloud (KI) path stays gated by isScanReady inside.
    if (settings.docScanEnabled) setScanOpen(true);
    else {
      // Take the user straight where the problem is, and say why on the way —
      // an alert they have to dismiss first only adds a tap.
      toast.show(t.scanConfigureFirst);
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
    // One write path: commit() sets state AND persists the same value, so a
    // debounce armed from the pre-scan record can't clobber ausweisImageId.
    await commit(next);
    toast.success(t.toastScanApplied);
  };

  const remainingPhotoSlots = Math.max(0, MAX_PHOTOS_PER_JOB - record.photoIds.length);

  const addPhotos = async (files: File[]) => {
    if (files.length === 0) return;
    const existing = await getBlobs(record.id);
    let sort = existing.reduce((m, b) => Math.max(m, b.sortOrder), 0);
    const newIds: string[] = [];
    for (const f of files) {
      if (record.photoIds.length + newIds.length >= MAX_PHOTOS_PER_JOB) break;
      try {
        const c = await compressImage(f, 'standard');
        const blob = await dataUrlToBlob(c.dataUrl);
        const blobId = newId();
        sort += 1;
        await saveBlob({
          id: blobId,
          jobcardId: record.id,
          sortOrder: sort,
          kind: 'photo',
          mime: 'image/jpeg',
          data: blob,
          sha256: c.contentHash,
          createdAt: Date.now(),
        });
        newIds.push(blobId);
      } catch (err) {
        console.warn('[photo] add failed:', err);
      }
    }
    if (newIds.length) {
      await commit({ ...record, photoIds: [...record.photoIds, ...newIds] });
    }
  };

  const removePhoto = async (photoId: string) => {
    const ok = await confirm({
      title: t.photoDeleteTitle,
      message: t.photoDeleteBody,
      confirmLabel: t.delete,
      confirmVariant: 'danger',
    });
    if (!ok) return;
    await deleteBlob(photoId).catch(() => {});
    await commit({ ...record, photoIds: record.photoIds.filter((p) => p !== photoId) });
  };

  const handlePrint = async () => {
    try {
      // Flush first so the printed card reflects the latest keystroke.
      await autosave.flush();
      const html = await renderCardHtml(record, settings.workshop);
      const nr = record.jobNumber || record.id.slice(0, 6);
      await printJobCard(html, `Arbeitskarte-${nr}.pdf`);
      toast.success(t.toastPrinted);
    } catch (err) {
      toast.error(`${t.printFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const selectedParts = new Set(record.damagedParts);
  const toggleDamage = (partId: string) => {
    const next = new Set(selectedParts);
    if (next.has(partId)) next.delete(partId);
    else next.add(partId);
    actionStack.current.push({ kind: 'panel', id: partId });
    update({ damagedParts: Array.from(next) });
  };

  // Freehand strokes — functional updates are immune to stale record captures
  // (native listeners in CarMap may fire against an older closure).
  const strokes = record.damageStrokes ?? [];
  const addStroke = (stroke: DamageStroke) => {
    actionStack.current.push({ kind: 'stroke' });
    setRecord((r) => (r ? { ...r, damageStrokes: [...(r.damageStrokes ?? []), stroke] } : r));
  };

  /** Undo the last damage action of EITHER kind. Panel toggles are their own
   *  inverse, so replaying one undoes it. */
  const undoLast = () => {
    const last = actionStack.current.pop();
    if (!last) return;
    if (last.kind === 'stroke') {
      setRecord((r) => (r ? { ...r, damageStrokes: (r.damageStrokes ?? []).slice(0, -1) } : r));
      return;
    }
    setRecord((r) => {
      if (!r) return r;
      const next = new Set(r.damagedParts);
      if (next.has(last.id)) next.delete(last.id);
      else next.add(last.id);
      return { ...r, damagedParts: Array.from(next) };
    });
  };

  /** Clears strokes AND selection — deselecting ten panels one by one was ten
   *  taps, and the old button only ever cleared the drawing layer. */
  const resetDamage = async () => {
    const ok = await confirm({
      title: t.carmapReset,
      message: t.carmapResetConfirm,
      confirmLabel: t.carmapReset,
      confirmVariant: 'danger',
    });
    if (!ok) return;
    actionStack.current = [];
    update({ damageStrokes: [], damagedParts: [] });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => void leaveEditor()} icon={<ChevronLeft size={16} />}>
          {t.back}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {/* Replaces the Speichern button: the card is already saved, so the
              only thing left to communicate is whether that has happened yet. */}
          <span aria-live="polite" className="px-1 text-xs font-medium text-muted">
            {autosave.status === 'saving' || autosave.status === 'pending'
              ? t.autosaveSaving
              : autosave.status === 'error'
                ? t.autosaveFailed
                : t.saved}
          </span>
          <Button variant="ghost" onClick={() => void handleDiscard()}>
            {isNewRef.current ? t.discardCard : t.discardEdits}
          </Button>
          <Button variant="primary" onClick={handleScanClick} icon={<ScanLine size={16} />}>
            {t.scanAusweis}
          </Button>
          <Button variant="secondary" onClick={() => void handlePrint()} icon={<Printer size={16} />}>
            {t.printCard}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Top data — two columns to cut scrolling */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
        {/* Kopf */}
        <Section title={t.sectionKopf}>
          <TextField record={record} update={update} field="jobNumber" label={t.jobNumber} />
          <Field label={t.colStatus}>
            <select
              value={record.status}
              onChange={(e) => update({ status: e.target.value as JobStatus })}
              className={inputClass}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {t[`status_${s}`]}
                </option>
              ))}
            </select>
          </Field>
          <DateField label={t.repDatum} value={record.repDatum ?? ''} onChange={(v) => update({ repDatum: v })} />
          <DateField label={t.abholdatum} value={record.abholdatum ?? ''} onChange={(v) => update({ abholdatum: v })} />
          <TextField record={record} update={update} field="schluesselCode" label={t.schluesselCode} />
          <TextField record={record} update={update} field="ersatzwagenKopf" label={t.ersatzwagenKopf} />
          <TextField record={record} update={update} field="kilometerstand" label={t.kilometerstand} />
          <CheckField record={record} update={update} field="automat" label={t.automat} className="self-end pb-2" />
        </Section>

        {/* Kunde / Halter */}
        <Section title={t.sectionKunde}>
          <TextField record={record} update={update} field="firma" label={t.firma} />
          <TextField record={record} update={update} field="name" label={t.colName} />
          <TextField record={record} update={update} field="vorname" label={t.vorname} />
          <TextField record={record} update={update} field="strasse" label={t.strasse} />
          <TextField record={record} update={update} field="plzOrt" label={t.plzOrt} />
          <TextField record={record} update={update} field="telefon" label={t.telefon} />
          <TextField record={record} update={update} field="telefon2" label={t.telefon2} />
          <div className="sm:col-span-2">
            <TextAreaField record={record} update={update} field="kundeNotiz" label={t.kundeNotiz} rows={2} />
          </div>
        </Section>
          </div>

          <div className="space-y-4">
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
          <TextField record={record} update={update} field="schadenNr" label={t.schadenNr} />
        </Section>
          </div>
        </div>

        {/* Schaden — car map. Full card width: the map used to sit in one half
            of a two-column grid, which on the tablet made the 49 panels roughly
            half the size they needed to be. */}
        <div className="rounded-card border border-line bg-paper p-4 shadow-elev-card">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t.sectionSchaden}</h2>
            <span className="text-xs text-faint">{mapMode === 'draw' ? t.carmapHintDraw : t.schadenHint}</span>
          </div>

          <div className="mx-auto w-full max-w-3xl">
            <CarMap
              selected={selectedParts}
              strokes={strokes}
              mode={mapMode}
              onToggle={toggleDamage}
              onStrokeAdd={addStroke}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-control border border-line-strong">
              <button
                type="button"
                onClick={() => setMapMode('select')}
                aria-pressed={mapMode === 'select'}
                className={`ui-control px-3 text-xs font-semibold ${
                  mapMode === 'select' ? 'bg-accent text-white' : 'bg-paper text-ink hover:bg-surface'
                }`}
              >
                {t.carmapModeSelect}
              </button>
              <button
                type="button"
                onClick={() => setMapMode('draw')}
                aria-pressed={mapMode === 'draw'}
                className={`ui-control px-3 text-xs font-semibold ${
                  mapMode === 'draw' ? 'bg-accent text-white' : 'bg-paper text-ink hover:bg-surface'
                }`}
              >
                {t.carmapModeDraw}
              </button>
            </div>

            {/* Undo now covers BOTH modes — it used to be hidden behind draw mode
                and did not know about panel selection at all. */}
            <Button size="sm" variant="secondary" onClick={undoLast} disabled={actionStack.current.length === 0} icon={<Undo2 size={14} />}>
              {t.carmapUndo}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void resetDamage()} disabled={strokes.length === 0 && record.damagedParts.length === 0} icon={<Trash2 size={14} />}>
              {t.carmapReset}
            </Button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="flex flex-wrap content-start gap-1.5">
              {record.damagedParts.length === 0 ? (
                <span className="text-xs text-faint">{t.noDamageSelected}</span>
              ) : (
                record.damagedParts.map((partId) => {
                  const chipCls = CHIP_CLASSES[panelCategory(partId)];
                  return (
                    <button
                      key={partId}
                      onClick={() => toggleDamage(partId)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${chipCls}`}
                      title={t.delete}
                      aria-label={`${panelLabel(partId)} — ${t.delete}`}
                    >
                      {panelLabel(partId)} <X size={12} />
                    </button>
                  );
                })
              )}
            </div>
            <Field label={t.schadenNotiz}>
              <textarea
                value={record.schadenNotiz ?? ''}
                onChange={(e) => update({ schadenNotiz: e.target.value })}
                rows={4}
                className={`${inputClass} resize-y`}
              />
            </Field>
          </div>
        </div>

        {/* Arbeiten / Material (back of card) */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.sectionArbeiten}</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <TextAreaField record={record} update={update} field="spenglerarbeit" label={t.spenglerarbeit} />
            <TextAreaField record={record} update={update} field="ersatzteileKleinmat" label={t.ersatzteileKleinmat} />
            <TextAreaField record={record} update={update} field="lackierarbeit" label={t.lackierarbeit} />
            <TextAreaField record={record} update={update} field="lackmaterial" label={t.lackmaterial} />
            <TextAreaField record={record} update={update} field="kittsatz" label={t.kittsatz} />
            <TextAreaField record={record} update={update} field="nebenarbeiten" label={t.nebenarbeiten} />
            <TextAreaField record={record} update={update} field="schneidfaden" label={t.schneidfaden} />
            <TextAreaField record={record} update={update} field="arbeitenErsatzwagen" label={t.arbeitenErsatzwagen} />
            <div className="sm:col-span-2 lg:col-span-3">
              <TextAreaField record={record} update={update} field="notes" label={t.notes} rows={2} />
            </div>
          </div>
        </div>

        {/* Fotos + Ausweis — side by side */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className={`rounded-lg border border-slate-200 bg-white p-4 ${ausweisUrl ? '' : 'lg:col-span-2'}`}>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.sectionFotos}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPhotoCamOpen(true)}
                disabled={remainingPhotoSlots === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Camera size={14} /> {t.addPhotoCamera}
              </button>
              <button
                onClick={() => photoFileRef.current?.click()}
                disabled={remainingPhotoSlots === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ImagePlus size={14} /> {t.addPhotoFile}
              </button>
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                multiple
                className="hidden"
                onChange={(e) => { void addPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }}
              />
            </div>
          </div>
          {photoThumbs.length === 0 ? (
            <p className="text-xs text-slate-400">{remainingPhotoSlots === 0 ? t.photoMaxReached : '—'}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photoThumbs.map((p) => (
                <div key={p.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setLightbox({ url: p.url, title: t.sectionFotos })}
                    className="block w-full"
                    aria-label={t.photoOpen}
                  >
                    <img src={p.url} alt="" className="h-24 w-full rounded-control border border-line object-cover" />
                  </button>
                  <button
                    onClick={() => void removePhoto(p.id)}
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white shadow-elev-card hover:bg-danger-strong"
                    title={t.delete}
                    aria-label={t.delete}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ausweis thumbnail */}
        {ausweisUrl && (
          <Section title={t.ausweisFoto}>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => setLightbox({ url: ausweisUrl, title: t.ausweisFoto })}
                className="block w-full"
                aria-label={t.photoOpen}
              >
                <img
                  src={ausweisUrl}
                  alt={t.ausweisFoto}
                  className="max-h-56 w-full rounded-control border border-line object-contain"
                />
              </button>
            </div>
          </Section>
        )}
        </div>
      </div>

      {/* No Speichern/Abbrechen row: the card autosaves, and leaving is the
          back arrow at the top. */}
      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={() => void leaveEditor()}>
          {t.done}
        </Button>
      </div>

      <DocumentScanModal
        open={scanOpen}
        provider={settings.docScanProvider}
        apiKey={getDocScanKey()}
        accountId={settings.docScanProviderAccountId}
        model={settings.docScanModel}
        cloudReady={isScanReady(settings)}
        country="CH"
        onApply={(fields, original) => void handleScanApply(fields, original)}
        onClose={() => setScanOpen(false)}
      />

      {photoCamOpen && (
        <CameraCaptureModal
          remainingSlots={remainingPhotoSlots}
          onCapture={(files) => { setPhotoCamOpen(false); void addPhotos(files); }}
          onCancel={() => setPhotoCamOpen(false)}
        />
      )}

      {/* Lightbox — a 96px thumbnail is not enough to check a scan against. */}
      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        title={lightbox?.title}
        size="max-w-4xl"
      >
        {lightbox && (
          <img src={lightbox.url} alt={lightbox.title} className="mx-auto max-h-[75vh] w-auto object-contain" />
        )}
      </Modal>
    </div>
  );
}
