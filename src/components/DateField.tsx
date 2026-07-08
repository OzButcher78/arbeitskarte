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
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="TT.MM.JJJJ"
          className="w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Kalender"
          aria-label="Kalender öffnen"
          aria-expanded={open}
        >
          <Calendar size={16} />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Voriger Monat"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold capitalize text-slate-700">{monthLabel}</span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Nächster Monat"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-slate-400">
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
                  ? 'bg-blue-600 text-white'
                  : isToday
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100';
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
            <div className="mt-1.5 flex items-center justify-between border-t border-slate-100 pt-1.5">
              <button
                type="button"
                onClick={() => { onChange(formatCH(new Date())); setOpen(false); }}
                className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
              >
                Heute
              </button>
              {value.trim() && (
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false); }}
                  className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
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
