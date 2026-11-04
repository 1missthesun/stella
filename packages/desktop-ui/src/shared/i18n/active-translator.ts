import { DEFAULT_LOCALE } from "@stella/contracts/locales";
import { getEagerCatalog, translate, type TranslateParams } from "./catalogs";

type Translator = (key: string, params?: TranslateParams) => string;

let active: Translator = (key, params) =>
  translate(getEagerCatalog(DEFAULT_LOCALE), key, params);

/** The provider's translator, for code that runs outside React (toasts from plain modules). */
export const translateNow: Translator = (key, params) => active(key, params);

export const setActiveTranslator = (next: Translator): void => {
  active = next;
};
