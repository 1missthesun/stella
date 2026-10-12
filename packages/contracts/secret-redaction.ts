export const SECRET_FRAGMENT_WINDOW = 12;
export const SECRET_MIN_MATCH_LENGTH = 8;
export const SECRET_REDACTION_MARK = "[REDACTED]";

const MODULUS_A = 67_108_859;
const MODULUS_B = 67_108_837;
const KEY_SPLIT = 67_108_864;

export type SecretFingerprintParams = { baseA: number; baseB: number };

export type SecretFingerprints = SecretFingerprintParams & {
  windows: readonly { length: number; hashes: readonly number[] }[];
};

export const EMPTY_SECRET_FINGERPRINTS: SecretFingerprints = {
  baseA: 1,
  baseB: 1,
  windows: [],
};

const SKIP_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\s\x00-\x1f\x7f]/y;

type Normalized = { text: string; origin: number[] };

const normalize = (input: string): Normalized => {
  const chars: string[] = [];
  const origin: number[] = [];
  let index = 0;
  while (index < input.length) {
    SKIP_RE.lastIndex = index;
    const skipped = SKIP_RE.exec(input);
    if (skipped && skipped[0].length > 0) {
      index += skipped[0].length;
      continue;
    }
    chars.push(input[index]!);
    origin.push(index);
    index += 1;
  }
  return { text: chars.join(""), origin };
};

const randomBase = (random: () => number, modulus: number): number =>
  65_536 + Math.floor(random() * (modulus - 65_537));

export const createSecretFingerprintParams = (
  random: () => number = Math.random,
): SecretFingerprintParams => ({
  baseA: randomBase(random, MODULUS_A),
  baseB: randomBase(random, MODULUS_B),
});

const power = (base: number, exponent: number, modulus: number): number => {
  let result = 1;
  for (let step = 0; step < exponent; step += 1) {
    result = (result * base) % modulus;
  }
  return result;
};

const forEachWindowHash = (
  text: string,
  length: number,
  params: SecretFingerprintParams,
  visit: (start: number, key: number) => void,
): void => {
  if (text.length < length) return;
  const powA = power(params.baseA, length - 1, MODULUS_A);
  const powB = power(params.baseB, length - 1, MODULUS_B);
  let hashA = 0;
  let hashB = 0;
  for (let index = 0; index < length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = (hashA * params.baseA + code) % MODULUS_A;
    hashB = (hashB * params.baseB + code) % MODULUS_B;
  }
  for (let start = 0; ; start += 1) {
    visit(start, hashA * KEY_SPLIT + hashB);
    const next = start + length;
    if (next >= text.length) return;
    const outgoing = text.charCodeAt(start);
    const incoming = text.charCodeAt(next);
    hashA =
      (((hashA - ((outgoing * powA) % MODULUS_A) + MODULUS_A) % MODULUS_A) *
        params.baseA +
        incoming) %
      MODULUS_A;
    hashB =
      (((hashB - ((outgoing * powB) % MODULUS_B) + MODULUS_B) % MODULUS_B) *
        params.baseB +
        incoming) %
      MODULUS_B;
  }
};

const utf8Base64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const secretEncodedVariants = (secret: string): string[] => {
  const variants = new Set<string>([secret]);
  try {
    const base64 = utf8Base64(secret);
    variants.add(base64);
    variants.add(base64.replace(/=+$/, ""));
    variants.add(
      base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    );
  } catch {
    return [...variants];
  }
  try {
    variants.add(encodeURIComponent(secret));
  } catch {
    return [...variants];
  }
  return [...variants];
};

export const fingerprintSecrets = (
  secrets: readonly string[],
  params: SecretFingerprintParams,
): SecretFingerprints => {
  const byLength = new Map<number, Set<number>>();
  for (const secret of secrets) {
    for (const variant of secretEncodedVariants(secret)) {
      const { text } = normalize(variant);
      if (text.length < SECRET_MIN_MATCH_LENGTH) continue;
      const length = Math.min(text.length, SECRET_FRAGMENT_WINDOW);
      let hashes = byLength.get(length);
      if (!hashes) {
        hashes = new Set();
        byLength.set(length, hashes);
      }
      const target = hashes;
      forEachWindowHash(text, length, params, (_start, key) => {
        target.add(key);
      });
    }
  }
  return {
    ...params,
    windows: [...byLength].map(([length, hashes]) => ({
      length,
      hashes: [...hashes],
    })),
  };
};

const lookupCache = new WeakMap<
  SecretFingerprints,
  { length: number; hashes: Set<number> }[]
>();

const lookupsOf = (fingerprints: SecretFingerprints) => {
  let lookups = lookupCache.get(fingerprints);
  if (!lookups) {
    lookups = fingerprints.windows.map((window) => ({
      length: window.length,
      hashes: new Set(window.hashes),
    }));
    lookupCache.set(fingerprints, lookups);
  }
  return lookups;
};

export const redactSecretFingerprints = (
  input: string,
  fingerprints: SecretFingerprints,
  mark: string = SECRET_REDACTION_MARK,
): string => {
  if (!input || fingerprints.windows.length === 0) return input;
  const lookups = lookupsOf(fingerprints);
  const shortest = Math.min(...lookups.map((lookup) => lookup.length));
  if (input.length < shortest) return input;
  const normalized = normalize(input);
  if (normalized.text.length < shortest) return input;
  const depth = new Int32Array(normalized.text.length + 1);
  let hit = false;
  for (const lookup of lookups) {
    forEachWindowHash(normalized.text, lookup.length, fingerprints, (start, key) => {
      if (!lookup.hashes.has(key)) return;
      depth[start] = (depth[start] ?? 0) + 1;
      depth[start + lookup.length] = (depth[start + lookup.length] ?? 0) - 1;
      hit = true;
    });
  }
  if (!hit) return input;
  const spans: [number, number][] = [];
  let open = 0;
  let runStart = -1;
  for (let index = 0; index <= normalized.text.length; index += 1) {
    open += depth[index] ?? 0;
    if (open > 0 && runStart < 0) runStart = index;
    if (open <= 0 && runStart >= 0) {
      spans.push([
        normalized.origin[runStart]!,
        normalized.origin[index - 1]! + 1,
      ]);
      runStart = -1;
    }
  }
  let output = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    output += input.slice(cursor, start) + mark;
    cursor = end;
  }
  return output + input.slice(cursor);
};

export const redactSecretFingerprintsDeep = <T>(
  value: T,
  fingerprints: SecretFingerprints,
  depth = 0,
): T => {
  if (fingerprints.windows.length === 0 || depth > 12) return value;
  if (typeof value === "string") {
    return redactSecretFingerprints(value, fingerprints) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const redacted = redactSecretFingerprintsDeep(entry, fingerprints, depth + 1);
      if (redacted !== entry) changed = true;
      return redacted;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const redacted = redactSecretFingerprintsDeep(entry, fingerprints, depth + 1);
      if (redacted !== entry) changed = true;
      next[key] = redacted;
    }
    return (changed ? next : value) as T;
  }
  return value;
};

const TOKEN_PREFIX =
  "(?:sk-ant-|sk-(?:proj-|svcacct-)?|gh[pousr]_|github_pat_|xox[baprs]-|hf_|r8_|npm_|pypi-|glpat-|AIza|ya29\\.)";
const TOKEN_CHARS = "[A-Za-z0-9._~+/=-]";
const ANSI = "(?:\\x1b\\[[0-?]*[ -/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\))";
const LINE_BREAK = `(?:${ANSI}|\\r)*\\n[ \\t]*(?:[│┃|][ \\t]*)?(?:${ANSI})*`;
const WRAPPED_TOKEN_RE = new RegExp(
  `\\b${TOKEN_PREFIX}${TOKEN_CHARS}{16,}(?:${LINE_BREAK}${TOKEN_CHARS}{4,})+`,
  "g",
);

export const redactWrappedSecretTokens = (
  input: string,
  mask: (joined: string) => string = () => SECRET_REDACTION_MARK,
): string => {
  if (!input || !input.includes("\n")) return input;
  return input.replace(WRAPPED_TOKEN_RE, (match) =>
    mask(normalize(match).text.replace(/[│┃|]/g, "")),
  );
};
