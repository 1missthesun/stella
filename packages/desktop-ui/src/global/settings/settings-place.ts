type Translate = (key: string) => string;

/** "Settings › Tab › Card", built from the labels the Settings window shows. */
export const settingsPlace = (t: Translate, ...labelKeys: string[]): string =>
  [t("settings.title"), ...labelKeys.map((key) => t(key))].join(" › ");
