// Plain checks for shapes that only need a yes or no. They match the zod
// rules these files used (an object is any non-null, non-array object; a
// number is finite; optional means missing or undefined, never null) without
// loading zod, which costs a window about 650 KB of code and 3 MB of memory
// at every launch when only a few fields need checking.

export type UnknownRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (value: unknown): value is string =>
  typeof value === "string";

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

export const isOptional =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || check(value);

export const isArrayOf =
  <T>(check: (value: unknown) => value is T, minLength = 0) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.length >= minLength && value.every(check);

export const isOneOf =
  <const T extends readonly string[]>(options: T) =>
  (value: unknown): value is T[number] =>
    typeof value === "string" && (options as readonly string[]).includes(value);

/** Every listed field passes its check; other fields are left alone. */
export const hasFields = (
  value: unknown,
  fields: Readonly<Record<string, (field: unknown) => boolean>>,
): value is UnknownRecord =>
  isRecord(value) &&
  Object.entries(fields).every(([name, check]) => check(value[name]));
