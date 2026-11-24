import { DEFAULT_LOCALE } from "@stella/contracts/locales";
import { getEagerCatalog, translate, type TranslateParams } from "./catalogs";

type Translator = (key: string, params?: TranslateParams) => string;

let active: Translator = (key, params) =>
  translate(getEagerCatalog(DEFAULT_LOCALE), key, params);

export const translateNow: Translator = (key, params) => active(key, params);

export const setActiveTranslator = (next: Translator): void => {
  active = next;
};
