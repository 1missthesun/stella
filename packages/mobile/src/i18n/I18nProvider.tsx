import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type Catalog,
  getCachedCatalogSync,
  getEnglishCatalog,
  loadCatalogAsync,
  translate,
  translateArray,
  translatePlural,
  type TranslateParams,
} from "./catalogs";
import { deviceLanguageTags } from "./device-locale";
import {
  DEFAULT_LOCALE,
  isRtlLocale,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
  resolveBestLocale,
  SUPPORTED_LOCALES,
} from "@stella/contracts/locales";
import { applyLayoutDirection, needsDirectionFlip, syncLayoutDirection } from "./rtl";

type I18nContextValue = {
  locale: Locale;
  isRTL: boolean;
  setLocale: (locale: Locale) => void;
  localeChangeReloads: (next: Locale) => boolean;
  t: (key: string, params?: TranslateParams) => string;
  tArray: (key: string, params?: TranslateParams) => string[];
  tPlural: (key: string, count: number, params?: TranslateParams) => string;
  supportedLocales: ReadonlyArray<Locale>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const initialLocale = (): Locale => resolveBestLocale(deviceLanguageTags());

export interface I18nProviderProps {
  children: ReactNode;
}

// `settled` is false only for the timed-out boot stand-in below, whose locale
// is a guess: layout direction must not be flipped (an app reload) on a guess.
type I18nState = { locale: Locale; catalog: Catalog; settled: boolean };

// Bounds how long the first screen waits for its language; past it the app
// shows English and swaps in the language when it arrives.
const I18N_BOOT_TIMEOUT_MS = 1500;

const readStoredLocale = async (): Promise<Locale | null> => {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    return null;
  }
};

// Non-English catalogs are unpacked from their pack on the first launch (and
// after an update that changed them), which is asynchronous. The first screen
// must not mount until its language is known and loaded, or it would paint in
// English (or the device language instead of the chosen one) and then switch.
// This starts at module load, so it runs alongside the font load that holds
// the first render anyway, and `I18nProvider` renders nothing until it lands.
let bootState: I18nState | null = null;
let bootTimedOut = false;
const bootLoad: Promise<I18nState> = (async () => {
  const locale = (await readStoredLocale()) ?? initialLocale();
  const catalog = getCachedCatalogSync(locale) ?? (await loadCatalogAsync(locale));
  return { locale, catalog, settled: true };
})();
const boot: Promise<I18nState> = Promise.race([
  bootLoad,
  new Promise<I18nState>((resolve) => {
    setTimeout(() => {
      bootTimedOut = true;
      resolve({ locale: DEFAULT_LOCALE, catalog: getEnglishCatalog(), settled: false });
    }, I18N_BOOT_TIMEOUT_MS);
  }),
]).then((state) => {
  bootState = state;
  return state;
});

export function I18nProvider({ children }: I18nProviderProps) {
  const [state, setState] = useState<I18nState | null>(() => bootState);
  const requestedLocale = useRef<Locale | null>(null);

  useEffect(() => {
    let cancelled = false;
    void boot.then((booted) => {
      if (cancelled) return;
      setState((current) => current ?? booted);
      if (!bootTimedOut) return;
      // Late language: swap it in unless the user has picked one since.
      void bootLoad.then((late) => {
        if (cancelled || requestedLocale.current !== null) return;
        setState(late);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = state?.locale ?? DEFAULT_LOCALE;
  const catalog = state?.catalog ?? getEnglishCatalog();
  const settled = state?.settled ?? false;

  useEffect(() => {
    if (settled) syncLayoutDirection(locale);
  }, [locale, settled]);

  const setLocale = useCallback((next: Locale) => {
    if (!isSupportedLocale(next)) return;
    requestedLocale.current = next;
    void AsyncStorage.setItem(LOCALE_STORAGE_KEY, next).catch(() => undefined);
    // The language and its strings switch together, once its pack is loaded
    // (a few milliseconds; synchronous when it was used before).
    const cached = getCachedCatalogSync(next);
    if (cached) {
      setState({ locale: next, catalog: cached, settled: true });
    } else {
      void loadCatalogAsync(next).then((loaded) => {
        if (requestedLocale.current === next) {
          setState({ locale: next, catalog: loaded, settled: true });
        }
      });
    }
    void applyLayoutDirection(next);
  }, []);

  const t = useCallback(
    (key: string, params?: TranslateParams) => translate(catalog, key, params),
    [catalog],
  );

  const tArray = useCallback(
    (key: string, params?: TranslateParams) =>
      translateArray(catalog, key, params),
    [catalog],
  );

  const tPlural = useCallback(
    (key: string, count: number, params?: TranslateParams) =>
      translatePlural(catalog, locale, key, count, params),
    [catalog, locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      isRTL: isRtlLocale(locale),
      setLocale,
      localeChangeReloads: needsDirectionFlip,
      t,
      tArray,
      tPlural,
      supportedLocales: SUPPORTED_LOCALES,
    }),
    [locale, setLocale, t, tArray, tPlural],
  );

  // Held under the native splash until the language is loaded (see `boot`).
  if (!state) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const FALLBACK: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  isRTL: false,
  setLocale: () => {
    /* no-op — provider missing */
  },
  localeChangeReloads: () => false,
  t: (key, params) => translate(getEnglishCatalog(), key, params),
  tArray: (key, params) => translateArray(getEnglishCatalog(), key, params),
  tPlural: (key, count, params) =>
    translatePlural(
      getEnglishCatalog(),
      DEFAULT_LOCALE,
      key,
      count,
      params,
    ),
  supportedLocales: SUPPORTED_LOCALES,
};

/**
 * Reading i18n outside the provider falls back to English rather than
 * throwing. On mobile the alternative is a fatal render error in release
 * (see the boot-crash ErrorBoundary in `app/_layout.tsx`), and untranslated
 * English is strictly better than a dead app.
 */
function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? FALLBACK;
}

export function useT() {
  return useI18n().t;
}

export function useTPlural() {
  return useI18n().tPlural;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export const i18nFallback = FALLBACK;
