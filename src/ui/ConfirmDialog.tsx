// ============================================================================
// useConfirm — a promise-returning replacement for window.confirm.
// ----------------------------------------------------------------------------
// window.confirm gives you exactly two buttons, OK and Abbrechen, which forced
// the backup-restore flow to encode a THREE-way choice as a chain of four
// prompts where "Abbrechen" secretly meant "Zusammenführen". Here the buttons
// are named, so a choice can be stated as a choice.
// ============================================================================

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button, type ButtonVariant } from './Button';

export interface ConfirmChoice<V extends string = string> {
  value: V;
  label: string;
  variant?: ButtonVariant;
}

export interface ConfirmOptions<V extends string = string> {
  title: string;
  /** Body text. Name the object being acted on — "diese Karte" helps nobody. */
  message?: React.ReactNode;
  /** Confirm label for the simple yes/no form. */
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  /** Three or more named outcomes instead of yes/no. Resolves to `value`, or
   *  null when dismissed. */
  choices?: ConfirmChoice<V>[];
  nested?: boolean;
}

type Resolver = (value: string | null) => void;

interface ConfirmApi {
  /** Yes/no. Resolves true when confirmed. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Named outcomes. Resolves the chosen `value`, or null when dismissed. */
  choose: <V extends string>(opts: ConfirmOptions<V> & { choices: ConfirmChoice<V>[] }) => Promise<V | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);

  const settle = useCallback((value: string | null) => {
    setOpts(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const open = useCallback((next: ConfirmOptions): Promise<string | null> => {
    // A second request while one is open cancels the first rather than losing
    // its promise forever.
    resolverRef.current?.(null);
    setOpts(next);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: async (o) => (await open(o)) === 'confirm',
      choose: async (o) => (await open(o as ConfirmOptions)) as never,
    }),
    [open],
  );

  const choices: ConfirmChoice[] =
    opts?.choices ?? [{ value: 'confirm', label: opts?.confirmLabel ?? 'OK', variant: opts?.confirmVariant ?? 'primary' }];

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <Modal
        open={opts !== null}
        onClose={() => settle(null)}
        title={opts?.title}
        size="max-w-md"
        nested={opts?.nested}
        footer={
          <>
            <Button variant="ghost" onClick={() => settle(null)}>
              {opts?.cancelLabel ?? 'Abbrechen'}
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              {choices.map((c) => (
                <Button key={c.value} variant={c.variant ?? 'primary'} onClick={() => settle(c.value)}>
                  {c.label}
                </Button>
              ))}
            </div>
          </>
        }
      >
        {opts?.message && <div className="text-sm leading-relaxed text-ink">{opts.message}</div>}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
