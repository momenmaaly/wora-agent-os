/**
 * WORA — language context. Arabic (RTL) is the default.
 * Persists `wora:lang` ('ar' | 'en'); drives <html lang/dir>.
 * t() reads nested keys with dot notation: t('nav.home').
 */
import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ar, en, type Dictionary, type Language } from './dictionaries.js';

const STORAGE_KEY = 'wora:lang';

interface I18nValue {
  lang: Language;
  dir: 'rtl' | 'ltr';
  t: (path: string) => string;
  setLang: (lang: Language) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function lookup(dictionary: Dictionary, path: string): string {
  const segments = path.split('.');
  let node: unknown = dictionary;
  for (const segment of segments) {
    if (node && typeof node === 'object' && segment in node) node = (node as Record<string, unknown>)[segment];
    else return path; // missing key → surface the key (loud, not silent)
  }
  return typeof node === 'string' ? node : path;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as Language) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
  });
  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
  }, [lang, dir]);

  const setLang = useCallback((next: Language) => setLangState(next === 'en' ? 'en' : 'ar'), []);
  const t = useCallback((path: string) => lookup(lang === 'ar' ? ar : en, path), [lang]);
  const value = useMemo(() => ({ lang, dir, t, setLang }), [lang, dir, t, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <LanguageProvider>');
  return ctx;
}
