// ============================================================================
// i18n SHIM — one German dict behind the same useLocale() contract the lifted
// components expect ({ locale, t }). No multi-locale machinery; if FR/IT is
// ever wanted, add a second dict and switch on `locale`.
// ============================================================================

import React, { createContext, useContext } from 'react';
import { de, type Translations } from './de';

export type { Translations };

interface LocaleContextValue {
  locale: 'de';
  t: Translations;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: 'de', t: de });

export const LocaleProvider = ({ children }: { children: React.ReactNode }) => {
  const value = React.useMemo<LocaleContextValue>(() => ({ locale: 'de', t: de }), []);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = () => useContext(LocaleContext);
