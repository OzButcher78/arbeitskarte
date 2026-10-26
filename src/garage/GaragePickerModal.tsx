// ============================================================================
// GaragePickerModal — the Garagen-Adressbuch.
// ----------------------------------------------------------------------------
// Opened from the editor's Garage card. Tapping an entry copies its name +
// address onto the job card (a snapshot — see JobCardRecord.garage*). Entries
// can be created, edited and deleted here; the card's current typed-in garage
// can be stored as a new entry in one tap ("Eingabe ins Adressbuch").
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { BookUser, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { TextField, inputClass } from '../ui/form';
import { useConfirm } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { useLocale } from '../i18n/locale';
import type { GarageRecord } from '../types/jobcard';
import { deleteGarage, loadGaragen, newGarage, saveGarage } from '../storage/garageRepository';

/** The garage fields as they live on a job card. */
export interface GarageSnapshot {
  name: string;
  strasse?: string;
  plzOrt?: string;
  telefon?: string;
  email?: string;
}

export interface GaragePickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen entry; the caller copies it onto the card. */
  onSelect: (garage: GarageRecord) => void;
  /** What is currently typed on the card — offered as a new entry when it
   *  isn't in the book yet. */
  current?: GarageSnapshot;
}

function addressLine(g: GarageSnapshot): string {
  return [g.strasse, g.plzOrt].map((v) => (v ?? '').trim()).filter(Boolean).join(', ');
}

export default function GaragePickerModal({ open, onClose, onSelect, current }: GaragePickerModalProps) {
  const { t } = useLocale();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [rows, setRows] = useState<GarageRecord[]>([]);
  const [query, setQuery] = useState('');
  /** Non-null while the edit form is showing. */
  const [draft, setDraft] = useState<GarageRecord | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const reload = async () => setRows(await loadGaragen());

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDraft(null);
    setDraftError(null);
    void reload();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((g) =>
      [g.name, g.strasse, g.plzOrt, g.telefon, g.email].filter(Boolean).join(' ').toLowerCase().includes(q),
    );
  }, [rows, query]);

  // The typed-in garage can be stored in one tap — unless an entry with the
  // same name already exists.
  const currentName = (current?.name ?? '').trim();
  const currentIsNew =
    currentName !== '' && !rows.some((g) => g.name.trim().toLowerCase() === currentName.toLowerCase());

  const startNew = (seed?: Partial<GarageRecord>) => {
    setDraftError(null);
    setDraft(newGarage(seed));
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setDraftError(t.garageNameRequired);
      return;
    }
    await saveGarage(draft);
    toast.success(t.garageSaved);
    setDraft(null);
    setDraftError(null);
    await reload();
  };

  const remove = async (g: GarageRecord) => {
    const ok = await confirm({
      title: t.garageDeleteTitle,
      message: (
        <>
          <strong>{g.name}</strong> — {t.garageDeleteBody}
        </>
      ),
      confirmLabel: t.delete,
      confirmVariant: 'danger',
      nested: true,
    });
    if (!ok) return;
    await deleteGarage(g.id);
    toast.success(t.garageDeleted);
    await reload();
  };

  const pick = (g: GarageRecord) => {
    onSelect(g);
    onClose();
  };

  const editing = draft !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.garageBookTitle}
      subtitle={editing ? undefined : t.garageBookSubtitle}
      leading={
        <span className="flex h-9 w-9 items-center justify-center rounded-control bg-surface-sunken text-muted">
          <BookUser size={18} />
        </span>
      }
      size="max-w-lg"
      nested
      footer={
        editing ? (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setDraftError(null);
              }}
            >
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={() => void saveDraft()}>
              {t.save}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t.close}
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              {currentIsNew && (
                <Button
                  variant="secondary"
                  icon={<Plus size={16} />}
                  onClick={() =>
                    startNew({
                      name: currentName,
                      strasse: current?.strasse ?? '',
                      plzOrt: current?.plzOrt ?? '',
                      telefon: current?.telefon ?? '',
                      email: current?.email ?? '',
                    })
                  }
                >
                  {t.garageSaveCurrent}
                </Button>
              )}
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => startNew()}>
                {t.garageNew}
              </Button>
            </div>
          </>
        )
      }
    >
      {editing && draft ? (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField record={draft} update={(p) => setDraft({ ...draft, ...p })} field="name" label={t.garageName} />
            {draftError && <p className="mt-1 text-xs font-medium text-danger">{draftError}</p>}
          </div>
          <TextField record={draft} update={(p) => setDraft({ ...draft, ...p })} field="strasse" label={t.strasse} />
          <TextField record={draft} update={(p) => setDraft({ ...draft, ...p })} field="plzOrt" label={t.plzOrt} />
          <TextField record={draft} update={(p) => setDraft({ ...draft, ...p })} field="telefon" label={t.telefon} />
          <TextField record={draft} update={(p) => setDraft({ ...draft, ...p })} field="email" label={t.email} />
        </div>
      ) : (
        <div className="space-y-3">
          {rows.length > 0 && (
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.garageSearch}
                className={`${inputClass} pl-9`}
              />
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState icon={<BookUser size={32} />} title={t.garageEmpty} hint={t.garageEmptyHint} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Search size={32} />} title={t.garageNoMatch} />
          ) : (
            <ul className="divide-y divide-line rounded-control border border-line">
              {filtered.map((g) => {
                const addr = addressLine(g);
                return (
                  <li key={g.id} className="flex items-center gap-1 pr-1">
                    <button
                      type="button"
                      onClick={() => pick(g)}
                      className="min-w-0 flex-1 px-3 py-2 text-left outline-none transition-colors hover:bg-surface focus-visible:bg-surface"
                    >
                      <span className="block truncate text-sm font-semibold text-ink">{g.name}</span>
                      {(addr || g.telefon || g.email) && (
                        <span className="block truncate text-xs text-muted">
                          {[addr, g.telefon, g.email].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                    <IconButton
                      aria-label={t.edit}
                      onClick={() => {
                        setDraftError(null);
                        setDraft({ ...g });
                      }}
                    >
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton variant="ghostDanger" aria-label={t.delete} onClick={() => void remove(g)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
