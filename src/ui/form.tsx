// ============================================================================
// Form primitives — one input style for the whole app.
// ----------------------------------------------------------------------------
// These used to live at the bottom of App.tsx, typed hard against JobCardRecord,
// so SettingsModal and DocumentScanModal each grew their own copy. Result: three
// different input styles and three label styles on screen at once.
//
// They are generic over the record type now, which costs nothing at the call
// site (`T` is inferred from `record`) and lets Settings drive both AppSettings
// and its nested `workshop` object through the same components.
// ============================================================================

import React from 'react';

/** Shared input chrome. Exported for the rare control that can't be one of the
 *  components below (a <select>, a masked input) but must still look identical. */
export const inputClass =
  'w-full rounded-control border border-line-strong bg-paper px-3 py-2 text-sm text-ink ' +
  'outline-none transition-colors placeholder:text-faint ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

export const labelClass = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted';

export function Section({
  title,
  children,
  className,
  /** Override the default two-column grid — Settings wants a single column. */
  bodyClassName = 'grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`rounded-card border border-line bg-paper p-4 shadow-elev-card ${className ?? ''}`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

interface BoundProps<T> {
  record: T;
  update: (patch: Partial<T>) => void;
  field: keyof T;
  label: string;
}

/** Text input bound to a string field of the record. */
export function TextField<T extends object>({
  record,
  update,
  field,
  label,
  upper,
  placeholder,
}: BoundProps<T> & { upper?: boolean; placeholder?: string }) {
  const value = (record[field] as string | undefined) ?? '';
  return (
    <Field label={label}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) =>
          update({ [field]: upper ? e.target.value.toUpperCase() : e.target.value } as Partial<T>)
        }
        className={`${inputClass} ${upper ? 'uppercase' : ''}`}
      />
    </Field>
  );
}

/** Multiline text bound to a string field of the record. */
export function TextAreaField<T extends object>({
  record,
  update,
  field,
  label,
  rows = 2,
}: BoundProps<T> & { rows?: number }) {
  const value = (record[field] as string | undefined) ?? '';
  return (
    <Field label={label}>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => update({ [field]: e.target.value } as Partial<T>)}
        className={`${inputClass} resize-y`}
      />
    </Field>
  );
}

/**
 * Integer input. Deliberately separate from TextField: routing a numeric field
 * through the generic string component writes a STRING into it with no type
 * error (the `as Partial<T>` cast hides it), which then corrupts arithmetic
 * downstream — `jobNextNumber` is the live example.
 */
export function NumberField<T extends object>({
  record,
  update,
  field,
  label,
  min,
}: BoundProps<T> & { min?: number }) {
  const value = record[field] as number | undefined;
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        value={Number.isFinite(value) ? String(value) : ''}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          update({ [field]: (Number.isFinite(n) ? n : 0) as unknown } as Partial<T>);
        }}
        className={inputClass}
      />
    </Field>
  );
}

/** Checkbox bound to a boolean field of the record. Grid alignment is the
 *  caller's business — pass `className` where it needs to line up with siblings. */
export function CheckField<T extends object>({
  record,
  update,
  field,
  label,
  className,
}: BoundProps<T> & { className?: string }) {
  const checked = Boolean(record[field]);
  return (
    <label className={`flex items-center gap-2 ${className ?? ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => update({ [field]: e.target.checked } as Partial<T>)}
        className="h-4.5 w-4.5 accent-accent"
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

/** Select bound to a string-union field of the record. */
export function SelectField<T extends object>({
  record,
  update,
  field,
  label,
  options,
}: BoundProps<T> & { options: { value: string; label: string }[] }) {
  const value = (record[field] as string | undefined) ?? '';
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => update({ [field]: e.target.value } as unknown as Partial<T>)}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
