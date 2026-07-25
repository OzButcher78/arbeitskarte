// ============================================================================
// DateField — a text input for a date plus a mini month-grid calendar picker.
// ----------------------------------------------------------------------------
// The card stores dates as free text (de-CH `dd.mm.jjjj`) so scanned / partial
// values survive. This field keeps the free-text input (type or paste anything)
// and adds a calendar button that pops a small month grid; picking a day writes
// `dd.mm.jjjj`. No dependencies — works the same on Electron / Android / browser.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { inputClass, labelClass } from '../ui/form';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatCH(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Parse `dd.mm.jjjj`, `d.m.jjjj` or ISO `jjjj-mm-tt`; else null. */
function parseValue(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isValid(d, Number(m[3]), Number(m[2]) - 1, Number(m[1])) ? d : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isValid(d, Number(m[1]), Number(m[2]) - 1, Number(m[3])) ? d : null;
  }
  return null;
}

function isValid(d: Date, y: number, mo: number, day: number): boolean {
  return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day;
}

/** Monday-first weekday index (0 = Monday … 6 = Sunday). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function DateField({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const selected = parseValue(value);
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const base = selected ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-centre the visible month on the selected value each time the picker OPENS
  // (not on every keystroke — depending on `value` would yank the grid back to
  // today while the user edits the text field with the popover still open).
  useEffect(() => {
    if (!open) return;
    const base = parseValue(value) ?? new Date();
    setView({ y: base.getFullYear(), m: base.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const firstOfMonth = new Date(view.y, view.m, 1);
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leading = mondayIndex(firstOfMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric' }).format(firstOfMonth);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const pick = (day: number) => {
    onChange(formatCH(new Date(view.y, view.m, day)));
    setOpen(false);
  };

  return (
    <div className="block" ref={wrapRef}>
      <span className={labelClass}>{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="TT.MM.JJJJ"
          className={`${inputClass} pr-10`}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-control p-1.5 text-faint hover:bg-surface-sunken hover:text-muted"
          title="Kalender"
          aria-label="Kalender öffnen"
          aria-expanded={open}
        >
          <Calendar size={16} />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-[var(--z-popover)] mt-1 w-64 rounded-card border border-line bg-paper p-2 shadow-elev-pop">
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="rounded-control p-1 text-muted hover:bg-surface-sunken"
                aria-label="Voriger Monat"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold capitalize text-ink">{monthLabel}</span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="rounded-control p-1 text-muted hover:bg-surface-sunken"
                aria-label="Nächster Monat"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-faint">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (day == null) return <div key={i} />;
                const d = new Date(view.y, view.m, day);
                const isSel = selected && sameDay(d, selected);
                const isToday = sameDay(d, today);
                const cls = isSel
                  ? 'bg-accent text-white'
                  : isToday
                    ? 'bg-accent-soft text-accent-strong font-semibold'
                    : 'text-ink hover:bg-surface-sunken';
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(day)}
                    className={`h-7 rounded text-xs ${cls}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
              <button
                type="button"
                onClick={() => { onChange(formatCH(new Date())); setOpen(false); }}
                className="rounded-control px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
              >
                Heute
              </button>
              {value.trim() && (
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false); }}
                  className="rounded-control px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-sunken"
                >
                  Löschen
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
