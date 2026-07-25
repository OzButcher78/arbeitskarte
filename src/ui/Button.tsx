// ============================================================================
// Button — the only place button styling is defined.
// ----------------------------------------------------------------------------
// Replaces the primary-button Tailwind string that was pasted verbatim in three
// places plus a scatter of one-off outline/ghost buttons. Sizing goes through
// `.ui-control` (src/index.css), which grows the hit area to 44px on a coarse
// pointer — the shop tablet.
// ============================================================================

import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ghostDanger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong shadow-elev-card',
  secondary: 'border border-line-strong bg-paper text-ink hover:bg-surface',
  ghost: 'text-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger-strong shadow-elev-card',
  ghostDanger: 'text-muted hover:bg-danger-soft hover:text-danger',
};

const SIZE: Record<ButtonSize, string> = {
  // `sm` keeps its own compact height — it is for dense inline rows, so it opts
  // out of `.ui-control`.
  sm: 'gap-1.5 px-2.5 py-1.5 text-xs',
  md: 'ui-control gap-2 px-4 py-2 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, e.g. `<Printer size={16} />`. */
  icon?: React.ReactNode;
  /** Stretch to the container width. */
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center rounded-control font-semibold',
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        block ? 'w-full' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Required — `title` alone is invisible to a finger on the tablet. */
  'aria-label': string;
  children: React.ReactNode;
}

/** Square, icon-only button. Same variants, but a guaranteed 44px touch target
 *  and a mandatory accessible name. */
export function IconButton({ variant = 'ghost', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={[
        'ui-icon-btn inline-flex items-center justify-center rounded-control',
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
