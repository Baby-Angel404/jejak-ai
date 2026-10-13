import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { id, type MessageKey } from './id';
import { en } from './en';

export type Lang = 'id' | 'en';
export type Theme = 'light' | 'dark';

const DICTS: Record<Lang, Record<MessageKey, string>> = { id: id as unknown as Record<MessageKey, string>, en };
const STORAGE_LANG = 'jejak.lang';
const STORAGE_THEME = 'jejak.theme';

export type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  toggleTheme: () => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

function readLang(): Lang {
  if (typeof localStorage === 'undefined') return 'id';
  return localStorage.getItem(STORAGE_LANG) === 'en' ? 'en' : 'id';
}

function readTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  const saved = localStorage.getItem(STORAGE_THEME);
  if (saved === 'dark' || saved === 'light') return saved;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_LANG, l); } catch { /* abaikan */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_THEME, next); } catch { /* abaikan */ }
      return next;
    });
  }, []);

  const t = useCallback<TFunc>((key, vars) => {
    let s = DICTS[lang][key] ?? DICTS.id[key] ?? String(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [lang]);

  const value = useMemo(() => ({ lang, theme, setLang, toggleTheme, t }), [lang, theme, setLang, toggleTheme, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n harus dipakai di dalam I18nProvider');
  return v;
}