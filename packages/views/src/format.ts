// How a view's numbers, money and dates read in `<Table>` cells and `<Chart>` axes, the same on
// every platform: in the user's locale, and in the currency the view names (`currency: "EUR"`) or
// else the one of the user's region. Pure JavaScript with Intl, which Bun, browsers and Hermes have;
// every Intl call has a plain fallback for engines with a partial Intl.

export type ValueFormat = "number" | "currency" | "percent" | "date";

/** The device's locale ("en-GB", "pt-PT"). */
export const viewLocale = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
};

const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK AD MC SM VA ME XK";
const CURRENCY_OF_REGION: Record<string, string> = {
  US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", IN: "INR", CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF", LI: "CHF",
  SE: "SEK", NO: "NOK", DK: "DKK", IS: "ISK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", RS: "RSD",
  UA: "UAH", RU: "RUB", TR: "TRY", IL: "ILS", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", EG: "EGP", MA: "MAD",
  ZA: "ZAR", NG: "NGN", KE: "KES", GH: "GHS", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
  KR: "KRW", SG: "SGD", HK: "HKD", TW: "TWD", TH: "THB", ID: "IDR", MY: "MYR", PH: "PHP", VN: "VND", PK: "PKR",
  BD: "BDT", LK: "LKR", NP: "NPR",
};
for (const region of EURO.split(" ")) CURRENCY_OF_REGION[region] = "EUR";

const regionOf = (locale: string): string | null => {
  try {
    const Locale = (Intl as { Locale?: new (tag: string) => { maximize(): { region?: string } } }).Locale;
    const region = Locale ? new Locale(locale).maximize().region : undefined;
    if (region) return region.toUpperCase();
  } catch {
    // An engine without Intl.Locale: read the tag.
  }
  return /[-_]([A-Za-z]{2})(?:[-_]|$)/u.exec(locale)?.[1]?.toUpperCase() ?? null;
};

/** The currency of the user's region (EUR in Portugal, GBP in the UK), USD when it isn't known. */
export const localCurrency = (locale = viewLocale()): string => CURRENCY_OF_REGION[regionOf(locale) ?? ""] ?? "USD";

const currencyCode = (currency: unknown, locale: string): string =>
  typeof currency === "string" && /^[A-Za-z]{3}$/u.test(currency.trim()) ? currency.trim().toUpperCase() : localCurrency(locale);

const numberFormats = new Map<string, Intl.NumberFormat | null>();
const numberFormat = (locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat | null => {
  const key = locale + JSON.stringify(options);
  let made = numberFormats.get(key);
  if (made === undefined) {
    try {
      made = new Intl.NumberFormat(locale, options);
    } catch {
      made = null;
    }
    numberFormats.set(key, made);
  }
  return made;
};

const plain = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);

/** A currency's symbol in this locale ("€", "$", "£"), and whether it goes before the number. */
function currencyParts(code: string, locale: string): { symbol: string; before: boolean } {
  const format = numberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }) ?? numberFormat(locale, { style: "currency", currency: code });
  try {
    const parts = format?.formatToParts(1) ?? [];
    const at = parts.findIndex((p) => p.type === "currency");
    const integer = parts.findIndex((p) => p.type === "integer");
    if (at >= 0) return { symbol: parts[at]!.value, before: at < integer };
  } catch {
    // formatToParts missing: fall through to the code.
  }
  return { symbol: code === "USD" ? "$" : code === "EUR" ? "€" : code === "GBP" ? "£" : `${code} `, before: true };
}

const withCurrency = (text: string, code: string, locale: string) => {
  const { symbol, before } = currencyParts(code, locale);
  if (text.startsWith("-")) return before ? `-${symbol}${text.slice(1)}` : `${text} ${symbol}`;
  return before ? `${symbol}${text}` : `${text} ${symbol}`;
};

/** A table cell's value, in full ("€1,234.50", "12.5%", "Mar 4, 2026"). */
export function formatValue(v: unknown, format: string | undefined, options: { currency?: unknown; locale?: string } = {}): string {
  const locale = options.locale ?? viewLocale();
  if (typeof v === "number" && Number.isFinite(v)) {
    if (format === "currency") {
      const code = currencyCode(options.currency, locale);
      return numberFormat(locale, { style: "currency", currency: code })?.format(v) ?? withCurrency(plain(v, 2), code, locale);
    }
    if (format === "percent") return `${numberFormat(locale, { maximumFractionDigits: 1 })?.format(v * 100) ?? plain(v * 100, 1)}%`;
    if (format === "date") return formatDate(v, locale);
    return numberFormat(locale, { maximumFractionDigits: 2 })?.format(v) ?? plain(v, 2);
  }
  if (format === "date" && typeof v === "string") return formatDate(v, locale);
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function formatDate(v: number | string, locale: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  try {
    return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** An axis label, short ("€12k", "1.5M", "40%"). */
export function formatAxis(v: number, format: string | undefined, options: { currency?: unknown; locale?: string } = {}): string {
  const locale = options.locale ?? viewLocale();
  if (format === "percent") return `${numberFormat(locale, { maximumFractionDigits: 1 })?.format(v * 100) ?? plain(v * 100, 1)}%`;
  const abs = Math.abs(v);
  const [scaled, suffix] = abs >= 1e9 ? [v / 1e9, "B"] : abs >= 1e6 ? [v / 1e6, "M"] : abs >= 1e4 ? [v / 1e3, "k"] : [v, ""];
  const digits = suffix ? 1 : abs > 0 && abs < 1 ? 2 : abs < 10 ? 1 : 0;
  const text = (numberFormat(locale, { maximumFractionDigits: digits })?.format(scaled) ?? plain(scaled, digits)) + suffix;
  return format === "currency" ? withCurrency(text, currencyCode(options.currency, locale), locale) : text;
}

/**
 * About how wide `text` sets at `size` points in a UI sans, for sizing table columns before
 * layout: tabular digits and currency signs are wider than the average letter, punctuation and
 * spaces narrower, so a column of amounts isn't cut off by a per-character guess.
 */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[0-9]/u.test(ch)) em += 0.6;
    else if (/[\s.,:;'|!il()[\]]/u.test(ch)) em += 0.3;
    else if (/[A-Z@%&#€£$¥₹mwMW]/u.test(ch)) em += 0.7;
    else em += 0.55;
  }
  return em * size;
}
