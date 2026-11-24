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
  /** False until the language and its catalog are loaded at startup. */
  ready: boolean;
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

type I18nState = { locale: Locale; catalog: Catalog; settled: boolean };

const I18N_BOOT_TIMEOUT_MS = 1500;

const unsettledEnglish = (): I18nState => ({
  locale: DEFAULT_LOCALE,
  catalog: getEnglishCatalog(),
  settled: false,
});

const readStoredLocale = async (): Promise<Locale | null> => {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    return null;
  }
};

let bootState: I18nState | null = null;
let bootTimedOut = false;
const bootLoad: Promise<I18nState> = (async () => {
  const locale = (await readStoredLocale()) ?? initialLocale();
  const catalog = getCachedCatalogSync(locale) ?? (await loadCatalogAsync(locale));
  return { locale, catalog, settled: true };
})().catch(() => unsettledEnglish());
const boot: Promise<I18nState> = Promise.race([
  bootLoad,
  new Promise<I18nState>((resolve) => {
    setTimeout(() => {
      bootTimedOut = bootState === null;
      resolve(unsettledEnglish());
    }, I18N_BOOT_TIMEOUT_MS);
  }),
]).then((state) => {
  bootState = state;
  return state;
});
void bootLoad.then((late) => {
  bootState = late;
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
  const ready = state !== null;

  useEffect(() => {
    if (settled) syncLayoutDirection(locale);
  }, [locale, settled]);

  const setLocale = useCallback((next: Locale) => {
    if (!isSupportedLocale(next)) return;
    requestedLocale.current = next;
    void AsyncStorage.setItem(LOCALE_STORAGE_KEY, next).catch(() => undefined);
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
      ready,
      locale,
      isRTL: isRtlLocale(locale),
      setLocale,
      localeChangeReloads: needsDirectionFlip,
      t,
      tArray,
      tPlural,
      supportedLocales: SUPPORTED_LOCALES,
    }),
    [locale, ready, setLocale, t, tArray, tPlural],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const FALLBACK: I18nContextValue = {
  ready: true,
  locale: DEFAULT_LOCALE,
  isRTL: false,
  setLocale: () => {},
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

function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? FALLBACK;
}

export function useT() {
  return useI18n().t;
}

export function useTPlural() {
  return useI18n().tPlural;
}

export function useI18nReady(): boolean {
  return useI18n().ready;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export const i18nFallback = FALLBACK;
