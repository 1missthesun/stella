type Translate = (key: string) => string;

export const settingsPlace = (t: Translate, ...labelKeys: string[]): string =>
  [t("settings.title"), ...labelKeys.map((key) => t(key))].join(" › ");
