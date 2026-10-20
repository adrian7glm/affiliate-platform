'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { i18nApi, type PublicLanguages, type PublicMessages } from '@/lib/i18n-api';
import {
  BUNDLED_LANGUAGES,
  DEFAULT_LANG,
  addLanguageFile,
  getT,
  isLangReady,
  loadLanguage,
  pickLang,
  rememberLang,
  savedLang,
  setActiveLang,
  type Lang,
  type LanguageInfo,
  type Messages,
  type Translator,
} from '@/lib/i18n';
import { readJson, writeJson } from '@/lib/storage';

export interface I18nValue extends Translator {
  /** Languages the platform offers, in the order to show them. */
  languages: LanguageInfo[];
  /** Switches the language and remembers the choice. */
  setLang: (lang: Lang) => void;
  /** Re-reads the offered languages and the admin's texts (after editing them). */
  refresh: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

const LANGUAGES_CACHE = 'ap.i18n.languages';
const messagesCacheKey = (lang: Lang) => `ap.i18n.messages.${lang}`;

/**
 * A translator for another language than the page's (e.g. a message for the customer). Until
 * that language file has downloaded, the page language is used.
 */
export function useTranslatorFor(lang: Lang): Translator {
  const page = useT();
  const [, setLoaded] = useState(0);
  const ready = isLangReady(lang);
  useEffect(() => {
    if (!ready) void loadLanguage(lang).then(() => setLoaded((n) => n + 1));
  }, [lang, ready]);
  if (lang === page.lang) return page;
  return ready ? getT(lang) : page;
}

/** Translations for client components. */
export function useT(): I18nValue {
  const value = useContext(I18nContext);
  if (value) return value;
  // Outside a provider (isolated component tests): bundled texts in the default language.
  return {
    ...getT(DEFAULT_LANG),
    languages: BUNDLED_LANGUAGES,
    setLang: () => undefined,
    refresh: () => undefined,
  };
}

/**
 * Holds the page language, the offered languages and the admin's text overrides.
 *
 * Without `lang`, the language is the one the person picked before, else the browser
 * language, else `fallback`; it is resolved after the first render, so server and client
 * render the same HTML. With `lang` (server-rendered public pages), that language is used
 * and `onChange` decides what switching does (the public pages navigate to `?lang=`).
 */
export function I18nProvider({
  lang: fixedLang,
  fallback = DEFAULT_LANG,
  languages: initialLanguages,
  overrides: initialOverrides,
  file,
  onChange,
  children,
}: {
  lang?: Lang;
  fallback?: Lang;
  languages?: LanguageInfo[];
  overrides?: Messages;
  /** The language file of `lang` when it is not in the bundle (server-rendered pages). */
  file?: Readonly<Record<string, unknown>> | null;
  onChange?: (lang: Lang) => void;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<Lang>(fixedLang ?? fallback);
  const [languages, setLanguages] = useState<LanguageInfo[]>(initialLanguages ?? BUNDLED_LANGUAGES);
  const [overrides, setOverrides] = useState<Record<Lang, Messages>>(
    fixedLang && initialOverrides ? { [fixedLang]: initialOverrides } : {},
  );
  // Public pages switch language by navigating to `?lang=`, which passes new overrides to this
  // same instance (remounting would wipe a half-filled form): adopt them as they arrive.
  if (fixedLang && initialOverrides && overrides[fixedLang] !== initialOverrides) {
    setOverrides((all) => ({ ...all, [fixedLang]: initialOverrides }));
  }
  // Before the first render, so server and browser render the same texts.
  if (fixedLang && file) addLanguageFile(fixedLang, file);
  const wanted = fixedLang ?? chosen;
  // A language whose file is still downloading keeps the previous language on screen.
  const [lastShown, setLastShown] = useState<Lang>(wanted);
  const [, setLoaded] = useState(0);
  const ready = isLangReady(wanted);
  const lang = ready ? wanted : isLangReady(lastShown) ? lastShown : 'en';
  useEffect(() => {
    if (ready) setLastShown(wanted);
    else void loadLanguage(wanted).then(() => setLoaded((n) => n + 1));
  }, [wanted, ready]);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Offered languages: from the API (an admin can add or hide one), cached for offline use.
  useEffect(() => {
    if (initialLanguages) return;
    const cached = readJson<PublicLanguages>(LANGUAGES_CACHE);
    if (cached?.languages?.length) setLanguages(cached.languages);
    const controller = new AbortController();
    i18nApi
      .languages({ signal: controller.signal })
      .then((result) => {
        if (!result.languages.length) return;
        writeJson(LANGUAGES_CACHE, result);
        setLanguages(result.languages);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [initialLanguages, version]);

  // The saved choice or the browser language, once mounted.
  useEffect(() => {
    if (fixedLang) return;
    const codes = languages.map((l) => l.code);
    setChosen(
      pickLang(
        {
          saved: savedLang(),
          browser: typeof navigator !== 'undefined' ? navigator.languages : null,
          available: codes,
        },
        fallback,
      ),
    );
  }, [fixedLang, fallback, languages]);

  // The admin's overrides for the current language, cached for offline use.
  useEffect(() => {
    if (fixedLang && initialOverrides) return;
    const cached = readJson<PublicMessages>(messagesCacheKey(lang));
    if (cached?.messages) setOverrides((all) => ({ ...all, [lang]: cached.messages }));
    const controller = new AbortController();
    i18nApi
      .messages(lang, { signal: controller.signal })
      .then((result) => {
        writeJson(messagesCacheKey(lang), result);
        setOverrides((all) => ({ ...all, [lang]: result.messages }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [lang, fixedLang, initialOverrides, version]);

  useEffect(() => {
    setActiveLang(lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => {
      rememberLang(next);
      if (onChange) onChange(next);
      else setChosen(next);
    },
    [onChange],
  );

  const value = useMemo<I18nValue>(() => {
    const custom = overrides[lang];
    const translator = custom ? getT(lang, { [lang]: custom }) : getT(lang);
    return { ...translator, languages, setLang, refresh };
  }, [lang, overrides, languages, setLang, refresh]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
