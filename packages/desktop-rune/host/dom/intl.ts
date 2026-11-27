// Chromium's ICU joins a medium or short date to a time with the locale's plain glue ("Nov 25,
// 3:00 AM"); the system ICU Bun uses on macOS joins them with the long-date glue ("Nov 25 at
// 3:00 AM"). Intl.DateTimeFormat and Date#toLocaleString are wrapped to give Chromium's output.

const DATE_OPTIONS = ["weekday", "era", "year", "month", "day", "dateStyle"] as const;
const TIME_OPTIONS = ["hour", "minute", "second", "dayPeriod", "fractionalSecondDigits", "timeStyle"] as const;
const TIME_PARTS = new Set(["hour", "minute", "second", "dayPeriod", "fractionalSecond"]);
const DATE_PARTS = new Set(["weekday", "era", "year", "month", "day", "relatedYear", "yearName"]);
const SAMPLE = Date.UTC(2026, 10, 25, 10, 0, 0);
const PLAIN_GLUE = ", ";

type Options = Intl.DateTimeFormatOptions;

const hasAny = (options: object, keys: readonly string[]) => keys.some((key) => (options as Record<string, unknown>)[key] !== undefined);

export function installIntlGlue(scope: typeof globalThis = globalThis) {
  const Native = scope.Intl.DateTimeFormat;
  if ((Native as { __stellaGlue?: boolean }).__stellaGlue) return;
  const longGlue = new Map<string, string | null>();

  const wordGlue = (locale: string) => {
    let glue = longGlue.get(locale);
    if (glue === undefined) {
      const parts = new Native(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).formatToParts(SAMPLE);
      const time = parts.findIndex((part) => TIME_PARTS.has(part.type));
      const literal = time > 0 ? parts[time - 1]! : null;
      glue = literal?.type === "literal" && /\p{L}/u.test(literal.value) ? literal.value : null;
      longGlue.set(locale, glue);
    }
    return glue;
  };

  const glueFor = (resolved: Intl.ResolvedDateTimeFormatOptions): string | null => {
    if (!hasAny(resolved, DATE_OPTIONS) || !hasAny(resolved, TIME_OPTIONS)) return null;
    if (resolved.dateStyle === "long" || resolved.dateStyle === "full") return null;
    if (!resolved.dateStyle && (resolved.month === "long" || resolved.weekday === "long")) return null;
    return wordGlue(resolved.locale);
  };

  const rejoin = (parts: Intl.DateTimeFormatPart[], glue: string) => {
    const time = parts.findIndex((part) => TIME_PARTS.has(part.type));
    const literal = time > 1 ? parts[time - 1]! : null;
    if (literal?.type === "literal" && literal.value === glue && DATE_PARTS.has(parts[time - 2]!.type)) {
      parts[time - 1] = { type: "literal", value: PLAIN_GLUE };
    }
    return parts;
  };

  const glues = new WeakMap<Intl.DateTimeFormat, string>();
  const nativeFormat = Object.getOwnPropertyDescriptor(Native.prototype, "format")!.get!;
  const nativeFormatToParts = Native.prototype.formatToParts;

  class DateTimeFormat extends Native {
    constructor(locales?: string | string[], options?: Options) {
      super(locales, options);
      const glue = glueFor(this.resolvedOptions());
      if (glue) glues.set(this, glue);
    }
  }
  Object.defineProperty(DateTimeFormat.prototype, "format", {
    configurable: true,
    get(this: Intl.DateTimeFormat) {
      const glue = glues.get(this);
      if (!glue) return nativeFormat.call(this);
      return (date?: Date | number) => rejoin(nativeFormatToParts.call(this, date), glue).map((part) => part.value).join("");
    },
  });
  Object.defineProperty(DateTimeFormat.prototype, "formatToParts", {
    configurable: true,
    writable: true,
    value(this: Intl.DateTimeFormat, date?: Date | number) {
      const parts = nativeFormatToParts.call(this, date);
      const glue = glues.get(this);
      return glue ? rejoin(parts, glue) : parts;
    },
  });

  const Wrapped = new Proxy(DateTimeFormat, {
    apply: (target, _self, args: [string | string[] | undefined, Options | undefined]) => new target(...args),
  }) as unknown as typeof Intl.DateTimeFormat & { __stellaGlue: boolean };
  Object.defineProperty(Wrapped, "__stellaGlue", { value: true });
  Object.defineProperty(scope.Intl, "DateTimeFormat", { value: Wrapped, writable: true, configurable: true, enumerable: false });

  const nativeToLocaleString = scope.Date.prototype.toLocaleString;
  Object.defineProperty(scope.Date.prototype, "toLocaleString", {
    value: function toLocaleString(this: Date, locales?: string | string[], options?: Options) {
      if (options && hasAny(options, DATE_OPTIONS) && hasAny(options, TIME_OPTIONS)) return new Wrapped(locales, options).format(this);
      return nativeToLocaleString.call(this, locales, options);
    },
    writable: true,
    configurable: true,
  });
}
