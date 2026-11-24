import { createHmac, randomBytes } from "node:crypto";

import {
  BROWSER_SECRET_PLACEHOLDER_PATTERN,
  BROWSER_SECRET_PLACEHOLDER_PREFIX,
  containsBrowserSecretPlaceholder,
  isBrowserSecretPlaceholder,
} from "./secret-placeholder.js";

const MAX_SECRETS_PER_SESSION = 4_096;
const MAX_SESSIONS = 64;
const GENERIC_MIN_LENGTH = 6;
const PASSWORD_GENERIC_MIN_LENGTH = 4;
const INDEX_KEY_LENGTH = 3;
const MAX_JSON_DEPTH = 64;
const MAX_NESTED_JSON_CHARS = 2 * 1024 * 1024;
const PLACEHOLDER_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

type SecretEntry = {
  value: string;
  placeholder: string;
  sites: Set<string>;
  replayable: boolean;
};

type IndexedVariant = { text: string; placeholder: string };
type VariantIndex = Map<number, IndexedVariant[]>;

const indexKey = (text: string, at: number): number =>
  (text.charCodeAt(at) * 65_536 + text.charCodeAt(at + 1)) * 65_536 +
  text.charCodeAt(at + 2);

const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "net.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "co.kr", "or.kr",
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in",
  "com.br", "net.br", "org.br",
  "com.cn", "net.cn", "org.cn",
  "com.mx", "com.ar", "com.co", "com.tr", "com.sg", "com.my", "com.ph",
  "com.hk", "com.tw", "com.vn", "com.pk", "com.ng", "com.eg", "com.sa",
  "co.za", "co.id", "co.il", "co.th", "co.ke",
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev",
  "workers.dev", "herokuapp.com", "web.app", "firebaseapp.com", "appspot.com",
  "azurewebsites.net", "cloudfront.net", "amazonaws.com", "onrender.com",
  "fly.dev", "glitch.me", "repl.co", "ngrok.io", "ngrok-free.app",
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const siteOfHost = (rawHost: string): string | undefined => {
  let host = rawHost.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
  if (!host) return undefined;
  if (host.startsWith("[")) return host;
  host = host.replace(/:\d+$/, "");
  if (IPV4.test(host) || !host.includes(".")) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
};

export const siteOfUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const url = new URL(raw);
    if (!/^(?:https?|wss?):$/.test(url.protocol)) return undefined;
    return siteOfHost(url.hostname);
  } catch {
    return undefined;
  }
};

const isAbsoluteHttpUrl = (raw: unknown): raw is string =>
  typeof raw === "string" && /^(?:https?|wss?):\/\//i.test(raw.trim());

const SECRET_TOKENS = new Set([
  "auth", "authorization", "authtoken", "cookie", "cookies", "credential",
  "credentials", "csrf", "xsrf", "token", "secret", "secrets",
  "session", "sessionid", "sessid", "sid", "password", "passwd", "pwd",
  "passcode", "passphrase", "otp", "totp", "hotp", "signature", "sig", "jwt",
  "bearer", "apikey", "privatekey", "saml", "samlresponse",
]);
const KEY_QUALIFIERS = new Set([
  "api", "access", "secret", "private", "client", "app", "subscription",
  "license", "signing", "encryption", "master", "account", "service", "auth",
  "session",
]);
const CODE_QUALIFIERS = new Set([
  "auth", "authorization", "verification", "verify", "otp", "mfa", "2fa",
  "oauth", "login", "device", "confirmation", "confirm", "reset", "magic",
  "security", "sms", "email", "one", "access", "recovery", "backup",
]);
const ONE_TIME_TOKENS = new Set([
  "password", "passwd", "pwd", "passcode", "passphrase", "otp", "totp", "hotp",
  "pin",
]);
const DESCRIPTIVE_TOKENS = new Set([
  "url", "uri", "urls", "endpoint", "endpoints", "path", "type", "types",
  "method", "methods", "mode", "provider", "providers", "required", "enabled",
  "disabled", "status", "name", "names", "label", "expires", "expiry",
  "expiration", "exp", "length", "count", "max", "min", "timeout", "ttl",
  "scope", "scopes", "field", "fields", "header", "param", "policy", "format",
  "version", "hint", "placeholder", "supported", "allowed", "present",
  "valid", "strength", "lifetime", "duration", "storage", "store",
]);
const FUSED_SECRET_NAMES = [
  "apikey", "accesskey", "secretkey", "privatekey", "clientsecret",
  "accesstoken", "refreshtoken", "idtoken", "authtoken", "sessiontoken",
  "sessionid", "sessid", "phpsessid", "jsessionid", "csrftoken", "xsrftoken",
  "subscriptionkey", "authkey", "apitoken", "bearertoken", "sessionkey",
];

const nameTokens = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export const isSecretName = (
  name: string,
  options: Readonly<{ urlParam?: boolean }> = {},
): boolean => {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => DESCRIPTIVE_TOKENS.has(token))) return false;
  const fused = tokens.join("");
  if (FUSED_SECRET_NAMES.some((secret) => fused.endsWith(secret))) return true;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (SECRET_TOKENS.has(token)) return true;
    if (
      token === "key" &&
      ((index > 0 && KEY_QUALIFIERS.has(tokens[index - 1]!)) ||
        (options.urlParam && tokens.length === 1))
    ) {
      return true;
    }
    if (
      token === "code" &&
      (tokens.length === 1 ||
        tokens.some((other) => CODE_QUALIFIERS.has(other)))
    ) {
      return true;
    }
    if (token === "pin" && tokens.length === 1) return true;
  }
  return false;
};

const isOneTimeName = (name: string): boolean => {
  const tokens = nameTokens(name);
  return (
    tokens.some((token) => ONE_TIME_TOKENS.has(token)) ||
    (tokens.includes("code") && isSecretName(name))
  );
};

const NON_SECRET_HEADERS = new Set([
  ":authority", ":method", ":scheme", ":status", ":protocol",
]);
const SECRET_HEADERS = new Set([
  "authorization", "proxy-authorization", "x-api-key", "api-key",
  "x-csrf-token", "csrf-token", "x-xsrf-token", "x-auth-token",
  "x-access-token", "x-refresh-token", "x-session-token", "x-amz-security-token",
]);
const URL_HEADERS = new Set([
  "location", "referer", "referrer", "content-location", ":path",
]);

export const cookieValueIsSecret = (
  name: string,
  value: string,
  httpOnly?: boolean,
): boolean => {
  if (!value || isBrowserSecretPlaceholder(value)) return false;
  if (isSecretName(name)) return true;
  if (httpOnly === true && value.length >= 4) return true;
  if (value.length >= 12) return true;
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
};

const isUuid = (text: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);

const looksLikeTokenSegment = (segment: string): boolean => {
  if (segment.length < 24 || isUuid(segment) || segment.includes("${")) {
    return false;
  }
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(segment)) return true;
  if (/^[0-9a-f]+$/i.test(segment)) {
    return segment.length >= 32 && segment.length !== 40;
  }
  const body = segment.replace(/=+$/, "");
  if (segment.length - body.length > 2 || !/^[A-Za-z0-9_~+/-]+$/.test(body)) {
    return false;
  }
  const words = segment.split(/[-_]/);
  if (words.length > 1 && words.every((word) => /^[A-Za-z]+$/.test(word))) {
    return false;
  }
  const distinct = new Set(segment).size;
  const digit = /\d/.test(segment);
  const lower = /[a-z]/.test(segment);
  const upper = /[A-Z]/.test(segment);
  return (
    distinct >= 12 &&
    digit &&
    (lower || upper) &&
    ((lower && upper) || segment.length >= 32)
  );
};

export type SavedBrowserSecrets = Readonly<{
  key: string;
  secrets: readonly (readonly [value: string, sites: readonly string[]])[];
}>;

export class BrowserSecretVault {
  readonly #key: Uint8Array;
  readonly #byValue = new Map<string, SecretEntry>();
  readonly #byPlaceholder = new Map<string, SecretEntry>();
  #index: VariantIndex | null = null;
  #merged:
    | {
        base: VariantIndex;
        extra: ReadonlyMap<string, string>;
        index: VariantIndex;
      }
    | undefined;

  constructor(saved?: SavedBrowserSecrets) {
    this.#key = saved
      ? Uint8Array.from(atob(saved.key), (char) => char.charCodeAt(0))
      : randomBytes(32);
    for (const [value, sites] of saved?.secrets ?? []) {
      const entry = this.remember(value, undefined, true);
      for (const site of sites) entry.sites.add(site);
    }
  }

  get size(): number {
    return this.#byValue.size;
  }

  save(maxChars: number): SavedBrowserSecrets {
    const secrets: (readonly [string, readonly string[]])[] = [];
    let room = maxChars;
    for (const entry of [...this.#byValue.values()].reverse()) {
      if (!entry.replayable) continue;
      room -= entry.value.length + [...entry.sites].join().length;
      if (room < 0) break;
      secrets.push([entry.value, [...entry.sites]]);
    }
    return {
      key: btoa(String.fromCharCode(...this.#key)),
      secrets: secrets.reverse(),
    };
  }

  remember(
    value: string,
    site: string | undefined,
    replayable: boolean,
  ): SecretEntry {
    let entry = this.#byValue.get(value);
    if (entry) {
      this.#byValue.delete(value);
      this.#byValue.set(value, entry);
    } else {
      entry = {
        value,
        placeholder: this.#placeholderFor(value),
        sites: new Set(),
        replayable,
      };
      this.#byValue.set(value, entry);
      this.#byPlaceholder.set(entry.placeholder, entry);
      if (this.#byValue.size > MAX_SECRETS_PER_SESSION) {
        const oldest = this.#byValue.values().next().value;
        if (oldest) {
          this.#byValue.delete(oldest.value);
          this.#byPlaceholder.delete(oldest.placeholder);
        }
      }
      this.#index = null;
    }
    if (site) entry.sites.add(site);
    if (!replayable && entry.replayable) {
      entry.replayable = false;
      this.#index = null;
    }
    return entry;
  }

  lookup(placeholder: string): SecretEntry | undefined {
    return this.#byPlaceholder.get(placeholder);
  }

  replaceKnown(text: string, extra?: ReadonlyMap<string, string>): string {
    if (text.length < INDEX_KEY_LENGTH) return text;
    const index = this.#indexFor(extra);
    if (index.size === 0) return text;
    let output = "";
    let last = 0;
    let position = 0;
    const end = text.length - INDEX_KEY_LENGTH;
    while (position <= end) {
      const bucket = index.get(indexKey(text, position));
      let matched: IndexedVariant | undefined;
      if (bucket) {
        for (const variant of bucket) {
          if (text.startsWith(variant.text, position)) {
            matched = variant;
            break;
          }
        }
      }
      if (matched) {
        output += text.slice(last, position) + matched.placeholder;
        position += matched.text.length;
        last = position;
      } else {
        position += 1;
      }
    }
    return last === 0 ? text : output + text.slice(last);
  }

  #placeholderFor(value: string): string {
    const digest = createHmac("sha256", this.#key).update(value).digest();
    let body = "";
    for (let index = 0; index < 12; index += 1) {
      body += PLACEHOLDER_ALPHABET[digest[index]! & 31];
    }
    return `${BROWSER_SECRET_PLACEHOLDER_PREFIX}${body}`;
  }

  #indexFor(extra?: ReadonlyMap<string, string>): VariantIndex {
    if (!this.#index) {
      const variants: IndexedVariant[] = [];
      for (const entry of this.#byValue.values()) {
        const minimum = entry.replayable
          ? GENERIC_MIN_LENGTH
          : PASSWORD_GENERIC_MIN_LENGTH;
        if (entry.value.length < minimum) continue;
        for (const text of encodedVariants(entry.value)) {
          variants.push({ text, placeholder: entry.placeholder });
        }
      }
      this.#index = buildIndex(variants);
    }
    if (!extra || extra.size === 0) return this.#index;
    if (this.#merged?.base === this.#index && this.#merged.extra === extra) {
      return this.#merged.index;
    }
    const merged: IndexedVariant[] = [];
    for (const bucket of this.#index.values()) merged.push(...bucket);
    for (const [text, placeholder] of extra) {
      if (text.length >= INDEX_KEY_LENGTH) merged.push({ text, placeholder });
    }
    this.#merged = { base: this.#index, extra, index: buildIndex(merged) };
    return this.#merged.index;
  }
}

const encodedVariants = (value: string): string[] => {
  const variants = new Set([value]);
  try {
    variants.add(encodeURIComponent(value));
  } catch {
    // Lone surrogates cannot be URL-encoded; the raw form is still matched.
  }
  const json = JSON.stringify(value).slice(1, -1);
  variants.add(json);
  return [...variants];
};

const buildIndex = (
  variants: readonly IndexedVariant[],
): VariantIndex => {
  const index: VariantIndex = new Map();
  const sorted = [...variants].sort((a, b) => b.text.length - a.text.length);
  for (const variant of sorted) {
    if (variant.text.length < INDEX_KEY_LENGTH) continue;
    const key = indexKey(variant.text, 0);
    const bucket = index.get(key);
    if (bucket) bucket.push(variant);
    else index.set(key, [variant]);
  }
  return index;
};

const vaults = new Map<string, BrowserSecretVault>();

export const browserSecretVault = (sessionId: string): BrowserSecretVault => {
  let vault = vaults.get(sessionId);
  if (vault) {
    vaults.delete(sessionId);
  } else {
    vault = new BrowserSecretVault();
  }
  vaults.set(sessionId, vault);
  if (vaults.size > MAX_SESSIONS) {
    const oldest = vaults.keys().next().value;
    if (oldest !== undefined) vaults.delete(oldest);
  }
  return vault;
};

export class BrowserSecretMaskRun {
  readonly #vault: BrowserSecretVault;
  readonly #reverse: ReadonlyMap<string, string> | undefined;
  readonly #pending = new Set<SecretEntry>();
  site: string | undefined;
  masked = 0;

  constructor(
    vault: BrowserSecretVault,
    options: Readonly<{
      site?: string;
      reverse?: ReadonlyMap<string, string>;
    }> = {},
  ) {
    this.#vault = vault;
    this.site = options.site;
    this.#reverse = options.reverse;
  }

  get hasPendingSites(): boolean {
    return this.#pending.size > 0;
  }

  secret(
    value: string,
    site: string | undefined = this.site,
    replayable = true,
  ): string {
    if (!value || isBrowserSecretPlaceholder(value)) return value;
    const entry = this.#vault.remember(value, site, replayable);
    if (!site) this.#pending.add(entry);
    this.masked += 1;
    return entry.placeholder;
  }

  bindPendingSites(site: string | undefined): void {
    if (site) {
      for (const entry of this.#pending) entry.sites.add(site);
    }
    this.#pending.clear();
  }

  text(text: string, site: string | undefined = this.site): string {
    if (!text) return text;
    let output = this.#vault.replaceKnown(text, this.#reverse);
    output = maskTextPatterns(this, output, site);
    return output === text ? text : this.#vault.replaceKnown(output);
  }

  deep<T>(value: T, site: string | undefined = this.site, depth = 0): T {
    if (typeof value === "string") return this.text(value, site) as T;
    if (depth > MAX_JSON_DEPTH || value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const masked = this.deep(item, site, depth + 1);
        if (masked !== item) changed = true;
        return masked;
      });
      return (changed ? next : value) as T;
    }
    if (!isPlainRecord(value)) return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const masked = this.deep(item, site, depth + 1);
      if (masked !== item) changed = true;
      next[key] = masked;
    }
    return (changed ? next : value) as T;
  }
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const decodeComponent = (text: string, plus: boolean): string | undefined => {
  try {
    return decodeURIComponent(plus ? text.replace(/\+/g, " ") : text);
  } catch {
    return undefined;
  }
};

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const PREFIXED_KEY_PATTERN = new RegExp(
  [
    String.raw`\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}`,
    String.raw`\bsk-(?:ant-|proj-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}`,
    String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`,
    String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}`,
    String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
    String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
    String.raw`\bya29\.[A-Za-z0-9_-]{20,}`,
    String.raw`\bAIza[0-9A-Za-z_-]{35}`,
    String.raw`\bglpat-[A-Za-z0-9_-]{20,}`,
    String.raw`\bnpm_[A-Za-z0-9]{36}`,
    String.raw`\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}`,
  ].join("|"),
  "g",
);
const AUTH_SCHEME_PATTERN =
  /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/-]{12,}=*)/g;
const ABSOLUTE_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>\\`]+/gi;
const URL_PARAM_PATTERN =
  /((?:[?&#;]|&amp;)\s*)([A-Za-z0-9_.\-[\]%]{1,64})=([^&#\s"'<>\\;`]{4,})/g;

const maskTextPatterns = (
  run: BrowserSecretMaskRun,
  text: string,
  site: string | undefined,
): string => {
  let output = text;
  if (output.includes("PRIVATE KEY-----")) {
    output = output.replace(PRIVATE_KEY_PATTERN, (match) =>
      run.secret(match, site),
    );
  }
  if (output.includes("eyJ")) {
    output = output.replace(JWT_PATTERN, (match) => run.secret(match, site));
  }
  output = output.replace(PREFIXED_KEY_PATTERN, (match) =>
    run.secret(match, site),
  );
  output = output.replace(
    AUTH_SCHEME_PATTERN,
    (match, scheme: string, space: string, credential: string) =>
      containsBrowserSecretPlaceholder(credential) ||
      !/\d/.test(credential) ||
      !/[A-Za-z]/.test(credential)
        ? match
        : `${scheme}${space}${run.secret(credential, site)}`,
  );
  if (/:\/\//.test(output)) {
    output = output.replace(ABSOLUTE_URL_PATTERN, (url) =>
      protectUrl(run, url, siteOfUrl(url) ?? site, false),
    );
  }
  if (output.includes("=")) {
    output = output.replace(
      URL_PARAM_PATTERN,
      (match, lead: string, name: string, value: string) => {
        if (containsBrowserSecretPlaceholder(value)) return match;
        const decodedName = decodeComponent(name, true) ?? name;
        if (!isSecretName(decodedName, { urlParam: true })) return match;
        const decoded = decodeComponent(value, true) ?? value;
        return `${lead}${name}=${run.secret(decoded, site)}`;
      },
    );
  }
  return output;
};

export const protectUrl = (
  run: BrowserSecretMaskRun,
  raw: string,
  site: string | undefined,
  paths: boolean,
): string => {
  if (!raw || isBrowserSecretPlaceholder(raw)) return raw;
  const secretSite = site ?? siteOfUrl(raw) ?? run.site;
  const hashIndex = raw.indexOf("#");
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : undefined;
  const queryIndex = beforeHash.indexOf("?");
  let location = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : undefined;

  location = location.replace(
    /^([a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)([^\s@/]+)@/i,
    (match, prefix: string, password: string) =>
      containsBrowserSecretPlaceholder(password)
        ? match
        : `${prefix}${run.secret(decodeComponent(password, false) ?? password, secretSite)}@`,
  );
  if (paths) {
    const schemeEnd = location.indexOf("://");
    const pathStart =
      schemeEnd >= 0 ? location.indexOf("/", schemeEnd + 3) : 0;
    if (pathStart >= 0) {
      const head = location.slice(0, pathStart);
      const tail = location
        .slice(pathStart)
        .split("/")
        .map((segment) => {
          const decoded = decodeComponent(segment, false) ?? segment;
          return looksLikeTokenSegment(decoded)
            ? run.secret(decoded, secretSite)
            : segment;
        })
        .join("/");
      location = head + tail;
    }
  }
  let output = location;
  if (query !== undefined) {
    output += `?${protectPairs(run, query, secretSite, true)}`;
  }
  if (fragment !== undefined) {
    output += `#${fragment.includes("=") ? protectPairs(run, fragment, secretSite, true) : fragment}`;
  }
  return output;
};

const protectPairs = (
  run: BrowserSecretMaskRun,
  text: string,
  site: string | undefined,
  urlParams: boolean,
): string =>
  text
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      if (separator <= 0) return pair;
      const rawName = pair.slice(0, separator);
      const rawValue = pair.slice(separator + 1);
      if (!rawValue || containsBrowserSecretPlaceholder(rawValue)) return pair;
      const name = decodeComponent(rawName, true) ?? rawName;
      if (!isSecretName(name, { urlParam: urlParams })) return pair;
      const value = decodeComponent(rawValue, true) ?? rawValue;
      return `${rawName}=${run.secret(value, site)}`;
    })
    .join("&");

const protectCookieHeader = (
  run: BrowserSecretMaskRun,
  text: string,
  site: string | undefined,
): string =>
  text
    .split(/;\s*/)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return part;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1);
      return cookieValueIsSecret(name, value)
        ? `${name}=${run.secret(value, site)}`
        : part;
    })
    .join("; ");

const protectSetCookieLine = (
  run: BrowserSecretMaskRun,
  line: string,
  site: string | undefined,
): string => {
  const end = line.indexOf(";");
  const pair = end >= 0 ? line.slice(0, end) : line;
  const rest = end >= 0 ? line.slice(end) : "";
  const separator = pair.indexOf("=");
  if (separator <= 0) return line;
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (!value || isBrowserSecretPlaceholder(value)) return line;
  const secret =
    isSecretName(name) || value.length >= 8 || /httponly/i.test(rest);
  return secret ? `${name}=${run.secret(value, site)}${rest}` : line;
};

export const protectHeaderValue = (
  run: BrowserSecretMaskRun,
  name: string,
  value: unknown,
  site: string | undefined,
): unknown => {
  if (typeof value !== "string" || !value) return value;
  const lower = name.trim().toLowerCase();
  if (NON_SECRET_HEADERS.has(lower) || lower.startsWith("access-control-")) {
    return value;
  }
  if (lower === "cookie") return protectCookieHeader(run, value, site);
  if (lower === "set-cookie") {
    return value
      .split("\n")
      .map((line) => protectSetCookieLine(run, line, site))
      .join("\n");
  }
  if (URL_HEADERS.has(lower)) return protectUrl(run, value, site, true);
  if (lower === "authorization" || lower === "proxy-authorization") {
    const match = /^(\S+)(\s+)(\S[\s\S]*)$/.exec(value);
    return match
      ? `${match[1]}${match[2]}${run.secret(match[3]!, site)}`
      : run.secret(value, site);
  }
  if (SECRET_HEADERS.has(lower) || isSecretName(lower)) {
    return run.secret(value, site);
  }
  return value;
};

export const protectHeaders = (
  run: BrowserSecretMaskRun,
  headers: unknown,
  site: string | undefined,
): unknown => {
  if (Array.isArray(headers)) {
    return headers.map((header) =>
      isPlainRecord(header) && typeof header.name === "string"
        ? {
            ...header,
            value: protectHeaderValue(run, header.name, header.value, site),
          }
        : header,
    );
  }
  if (!isPlainRecord(headers)) return headers;
  const next: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    next[name] = protectHeaderValue(run, name, value, site);
  }
  return next;
};

const headerValue = (headers: unknown, wanted: string): string | undefined => {
  const lower = wanted.toLowerCase();
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (
        isPlainRecord(header) &&
        typeof header.name === "string" &&
        header.name.toLowerCase() === lower &&
        typeof header.value === "string"
      ) {
        return header.value;
      }
    }
    return undefined;
  }
  if (!isPlainRecord(headers)) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
};

const FORM_BODY = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/;
const COOKIE_STRING =
  /^\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[^;]*(?:;\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[^;]*)*;?\s*$/;

export const protectBody = (
  run: BrowserSecretMaskRun,
  body: unknown,
  contentType: string | undefined,
  site: string | undefined,
): unknown => {
  if (typeof body !== "string") {
    return body !== null && typeof body === "object"
      ? protectJson(run, body, site)
      : body;
  }
  if (!body) return body;
  const kind = (contentType ?? "").toLowerCase();
  const trimmed = body.trimStart();
  if (
    kind.includes("json") ||
    ((!kind || kind.startsWith("text/")) &&
      (trimmed.startsWith("{") || trimmed.startsWith("[")))
  ) {
    try {
      const parsed: unknown = JSON.parse(body);
      const before = run.masked;
      const protectedValue = protectJson(run, parsed, site);
      return run.masked === before ? body : JSON.stringify(protectedValue);
    } catch {}
  }
  if (
    kind.includes("x-www-form-urlencoded") ||
    (!kind && FORM_BODY.test(body))
  ) {
    return protectPairs(run, body, site, false);
  }
  if (kind.includes("multipart/form-data")) {
    return protectMultipart(run, body, contentType ?? "", site);
  }
  return body;
};

const protectMultipart = (
  run: BrowserSecretMaskRun,
  body: string,
  contentType: string,
  site: string | undefined,
): string => {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return body;
  const delimiter = `--${boundary}`;
  return body
    .split(delimiter)
    .map((part) => {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd < 0) return part;
      const headers = part.slice(0, headerEnd);
      if (/;\s*filename\*?=/i.test(headers)) return part;
      const name = /;\s*name="([^"]+)"/i.exec(headers)?.[1];
      if (!name || !isSecretName(name)) return part;
      const valueStart = headerEnd + 4;
      const valueEnd = part.endsWith("\r\n") ? part.length - 2 : part.length;
      const value = part.slice(valueStart, valueEnd);
      if (!value) return part;
      return `${part.slice(0, valueStart)}${run.secret(value, site)}${part.slice(valueEnd)}`;
    })
    .join(delimiter);
};

export const protectJson = (
  run: BrowserSecretMaskRun,
  value: unknown,
  site: string | undefined,
  key?: string,
  depth = 0,
): unknown => {
  if (depth > MAX_JSON_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => protectJson(run, item, site, key, depth + 1));
  }
  if (isPlainRecord(value)) {
    const pairName = typeof value.name === "string" ? value.name : undefined;
    const next: Record<string, unknown> = {};
    for (const [field, item] of Object.entries(value)) {
      if (
        field === "value" &&
        pairName !== undefined &&
        typeof item === "string"
      ) {
        const cookieShaped =
          "domain" in value || "httpOnly" in value || "path" in value;
        const secret = cookieShaped
          ? cookieValueIsSecret(
              pairName,
              item,
              value.httpOnly === true ? true : undefined,
            )
          : isSecretName(pairName);
        if (secret) {
          const cookieSite =
            cookieShaped && typeof value.domain === "string"
              ? (siteOfHost(value.domain) ?? site)
              : site;
          next[field] = run.secret(item, cookieSite);
          continue;
        }
      }
      next[field] = protectJson(run, item, site, field, depth + 1);
    }
    return next;
  }
  if (typeof value === "string") {
    if (!value || isBrowserSecretPlaceholder(value)) return value;
    if (key !== undefined && isSecretName(key)) {
      return run.secret(value, site, !isOneTimeName(key));
    }
    return protectNestedString(run, value, site, depth);
  }
  if (
    typeof value === "number" &&
    key !== undefined &&
    Number.isInteger(value) &&
    Math.abs(value) >= 1_000 &&
    isOneTimeName(key)
  ) {
    return run.secret(String(value), site, false);
  }
  return value;
};

const protectNestedString = (
  run: BrowserSecretMaskRun,
  text: string,
  site: string | undefined,
  depth: number,
): string => {
  const trimmed = text.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.length <= MAX_NESTED_JSON_CHARS &&
    ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const before = run.masked;
      const protectedValue = protectJson(run, parsed, site, undefined, depth + 1);
      return run.masked === before ? text : JSON.stringify(protectedValue);
    } catch {
      return text;
    }
  }
  if (text.length <= 16_384 && text.includes("=") && COOKIE_STRING.test(text)) {
    const pairs = text.split(";").filter((part) => part.includes("="));
    const firstName = pairs[0]?.split("=")[0]?.trim() ?? "";
    if (pairs.length > 1 || isSecretName(firstName)) {
      return protectCookieHeader(run, text, site);
    }
  }
  return text;
};

const protectCapturedExchange = (
  run: BrowserSecretMaskRun,
  entry: unknown,
): unknown => {
  if (!isPlainRecord(entry)) return entry;
  const site = siteOfUrl(entry.url) ?? run.site;
  const next: Record<string, unknown> = { ...entry };
  if (typeof entry.url === "string") {
    next.url = protectUrl(run, entry.url, site, true);
  }
  if (entry.headers !== undefined) {
    next.headers = protectHeaders(run, entry.headers, site);
  }
  if (entry.postData !== undefined) {
    next.postData = protectBody(
      run,
      entry.postData,
      headerValue(entry.headers, "content-type"),
      site,
    );
  }
  if (entry.responseHeaders !== undefined) {
    next.responseHeaders = protectHeaders(run, entry.responseHeaders, site);
  }
  if (entry.body !== undefined && entry.bodyBase64 !== true && entry.base64Encoded !== true) {
    const contentType =
      (typeof entry.mimeType === "string" ? entry.mimeType : undefined) ??
      headerValue(entry.responseHeaders ?? entry.headers, "content-type");
    next.body = protectBody(run, entry.body, contentType, site);
  }
  return next;
};

const protectHarEntry = (run: BrowserSecretMaskRun, entry: unknown): unknown => {
  if (!isPlainRecord(entry)) return entry;
  const request = isPlainRecord(entry.request) ? entry.request : undefined;
  const response = isPlainRecord(entry.response) ? entry.response : undefined;
  const site = siteOfUrl(request?.url) ?? run.site;
  const next: Record<string, unknown> = { ...entry };
  const cookies = (list: unknown) =>
    Array.isArray(list)
      ? list.map((cookie) =>
          isPlainRecord(cookie) &&
          typeof cookie.name === "string" &&
          typeof cookie.value === "string" &&
          cookieValueIsSecret(
            cookie.name,
            cookie.value,
            cookie.httpOnly === true ? true : undefined,
          )
            ? { ...cookie, value: run.secret(cookie.value, site) }
            : cookie,
        )
      : list;
  const pairs = (list: unknown, urlParams: boolean) =>
    Array.isArray(list)
      ? list.map((pair) =>
          isPlainRecord(pair) &&
          typeof pair.name === "string" &&
          typeof pair.value === "string" &&
          pair.value &&
          isSecretName(pair.name, { urlParam: urlParams })
            ? { ...pair, value: run.secret(pair.value, site) }
            : pair,
        )
      : list;
  if (request) {
    const postData = isPlainRecord(request.postData)
      ? {
          ...request.postData,
          ...(typeof request.postData.text === "string"
            ? {
                text: protectBody(
                  run,
                  request.postData.text,
                  typeof request.postData.mimeType === "string"
                    ? request.postData.mimeType
                    : headerValue(request.headers, "content-type"),
                  site,
                ),
              }
            : {}),
          ...(request.postData.params !== undefined
            ? { params: pairs(request.postData.params, false) }
            : {}),
        }
      : request.postData;
    next.request = {
      ...request,
      ...(typeof request.url === "string"
        ? { url: protectUrl(run, request.url, site, true) }
        : {}),
      headers: protectHeaders(run, request.headers, site),
      cookies: cookies(request.cookies),
      queryString: pairs(request.queryString, true),
      ...(postData !== undefined ? { postData } : {}),
    };
  }
  if (response) {
    const content = isPlainRecord(response.content) ? response.content : undefined;
    next.response = {
      ...response,
      headers: protectHeaders(run, response.headers, site),
      cookies: cookies(response.cookies),
      ...(typeof response.redirectURL === "string" && response.redirectURL
        ? { redirectURL: protectUrl(run, response.redirectURL, site, true) }
        : {}),
      ...(content &&
      typeof content.text === "string" &&
      content.encoding !== "base64"
        ? {
            content: {
              ...content,
              text: protectBody(
                run,
                content.text,
                typeof content.mimeType === "string"
                  ? content.mimeType
                  : headerValue(response.headers, "content-type"),
                site,
              ),
            },
          }
        : {}),
    };
  }
  return next;
};

export const protectHar = (run: BrowserSecretMaskRun, har: unknown): unknown => {
  if (!isPlainRecord(har) || !isPlainRecord(har.log)) return run.deep(har);
  const entries = Array.isArray(har.log.entries) ? har.log.entries : [];
  const structured = {
    ...har,
    log: {
      ...har.log,
      entries: entries.map((entry) => protectHarEntry(run, entry)),
    },
  };
  return run.deep(structured);
};

const protectCookieList = (run: BrowserSecretMaskRun, cookies: unknown) =>
  Array.isArray(cookies)
    ? cookies.map((cookie) => {
        if (
          !isPlainRecord(cookie) ||
          typeof cookie.name !== "string" ||
          typeof cookie.value !== "string" ||
          !cookieValueIsSecret(
            cookie.name,
            cookie.value,
            cookie.httpOnly === true ? true : undefined,
          )
        ) {
          return cookie;
        }
        const site =
          typeof cookie.domain === "string"
            ? (siteOfHost(cookie.domain) ?? run.site)
            : run.site;
        return { ...cookie, value: run.secret(cookie.value, site) };
      })
    : cookies;

const PAGE_DATA_ACTIONS = new Set([
  "evaluate",
  "evaluate_detached",
  "waitforfunction",
]);

export const protectActionData = (
  run: BrowserSecretMaskRun,
  action: string,
  params: Record<string, unknown> | undefined,
  data: unknown,
): unknown => {
  if (!isPlainRecord(data)) {
    return PAGE_DATA_ACTIONS.has(action) ? protectJson(run, data, run.site) : data;
  }
  switch (action) {
    case "requests":
      return Array.isArray(data.requests)
        ? {
            ...data,
            requests: data.requests.map((entry) =>
              protectCapturedExchange(run, entry),
            ),
          }
        : data;
    case "responsebody":
    case "authenticated_request":
      return protectCapturedExchange(
        run,
        data.url === undefined && typeof params?.url === "string"
          ? { ...data, url: params.url }
          : data,
      );
    case "authenticated_request_batch":
      return Array.isArray(data.responses)
        ? {
            ...data,
            responses: data.responses.map((entry) =>
              protectCapturedExchange(run, entry),
            ),
          }
        : data;
    case "cookies_get":
      return { ...data, cookies: protectCookieList(run, data.cookies) };
    case "har_stop":
      return data.log !== undefined
        ? { ...data, log: (protectHar(run, { log: data.log }) as { log: unknown }).log }
        : data;
    default:
      if (PAGE_DATA_ACTIONS.has(action) && "result" in data) {
        return { ...data, result: protectJson(run, data.result, run.site) };
      }
      return PAGE_DATA_ACTIONS.has(action) ? protectJson(run, data, run.site) : data;
  }
};

export const FIELD_EXPOSING_ACTIONS = new Set([
  "evaluate",
  "waitforfunction",
  "inputvalue",
  "getattribute",
  "innerhtml",
  "content",
]);

export const PAGE_SECRET_FIELDS_SCRIPT = `(() => {
  const fields = [];
  const push = (kind, name, value) => {
    if (typeof value === "string" && value && fields.length < 200) fields.push([kind, name || "", value]);
  };
  const visit = (root, depth) => {
    if (!root || depth > 4) return;
    for (const el of root.querySelectorAll("input")) {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
      if (type === "password" || /(?:^|\\s)(?:current-password|new-password|one-time-code)(?:\\s|$)/.test(autocomplete)) {
        push("password", el.name || el.id, el.value);
      } else if (type === "hidden") {
        push("hidden", el.name || el.id, el.value);
      }
    }
    for (const el of root.querySelectorAll("meta[name]")) push("meta", el.getAttribute("name"), el.getAttribute("content"));
    for (const frame of root.querySelectorAll("iframe,frame")) {
      try { visit(frame.contentDocument, depth + 1); } catch {}
    }
    const all = root.querySelectorAll("*");
    if (all.length <= 20000) for (const el of all) if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
  };
  visit(document, 0);
  return { href: location.href, fields };
})()`;

export const rememberPageSecretFields = (
  vault: BrowserSecretVault,
  report: unknown,
): string | undefined => {
  if (!isPlainRecord(report)) return undefined;
  const site = siteOfUrl(report.href);
  const fields = Array.isArray(report.fields) ? report.fields : [];
  for (const field of fields) {
    if (!Array.isArray(field)) continue;
    const [kind, name, value] = field as unknown[];
    if (typeof value !== "string" || !value) continue;
    if (kind === "password") {
      vault.remember(value, site, false);
    } else if (
      typeof name === "string" &&
      value.length >= 8 &&
      isSecretName(name)
    ) {
      vault.remember(value, site, true);
    }
  }
  return site;
};

export const rememberFilledSecret = (
  vault: BrowserSecretVault,
  value: string,
): void => {
  if (value) vault.remember(value, undefined, false);
};

const SETTLE_STATES = new Set(["settled", "timeout", "navigating"]);

export const mayCarryPageValues = (data: unknown): boolean => {
  const result = isPlainRecord(data) && "result" in data ? data.result : data;
  if (
    isPlainRecord(result) &&
    SETTLE_STATES.has(result.state as string) &&
    Object.keys(result).every((key) => key === "state" || key === "ms")
  ) {
    return false;
  }
  return hasMaskableText(result);
};

const hasMaskableText = (value: unknown, depth = 0): boolean => {
  if (typeof value === "string") return value.length >= PASSWORD_GENERIC_MIN_LENGTH;
  if (depth > MAX_JSON_DEPTH || value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) return value.some((item) => hasMaskableText(item, depth + 1));
  return Object.values(value).some((item) => hasMaskableText(item, depth + 1));
};

export class BrowserSecretPlaceholderError extends Error {
  constructor(
    message: string,
    readonly unreplayable?: string,
  ) {
    super(message);
    this.name = "BrowserSecretPlaceholderError";
  }
}

type SubstitutionMode = "raw" | "url" | "script";

export type TabSiteResolver = (tabId: number | undefined) => Promise<string | undefined>;

const SCRIPT_SAFE_CHAR = /[A-Za-z0-9 _\-.:/?=&+,;@!*()~%#]/;

const escapeForScript = (value: string): string => {
  let output = "";
  for (const character of value) {
    if (SCRIPT_SAFE_CHAR.test(character)) {
      output += character;
      continue;
    }
    const code = character.codePointAt(0)!;
    if (code > 0xffff) {
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const low = ((code - 0x10000) % 0x400) + 0xdc00;
      output += `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
    } else {
      output += `\\u${code.toString(16).padStart(4, "0")}`;
    }
  }
  return output;
};

const SCRIPT_URL_PATTERN = /\b(?:https?|wss?):\/\/([^\s"'`/?#\\:]+)/gi;

const describeSites = (sites: ReadonlySet<string>): string =>
  sites.size === 0 ? "an unknown site" : [...sites].join(", ");

class Substitution {
  readonly inserted = new Map<string, string>();
  changed = false;
  readonly #vault: BrowserSecretVault;
  readonly #tabSite: TabSiteResolver;
  readonly #tabSites = new Map<number | undefined, Promise<string | undefined>>();

  constructor(vault: BrowserSecretVault, tabSite: TabSiteResolver) {
    this.#vault = vault;
    this.#tabSite = tabSite;
  }

  tabSite(tabId: number | undefined): Promise<string | undefined> {
    let site = this.#tabSites.get(tabId);
    if (!site) {
      site = this.#tabSite(tabId).catch(() => undefined);
      this.#tabSites.set(tabId, site);
    }
    return site;
  }

  replace(
    text: string,
    mode: SubstitutionMode,
    destination: string | undefined,
    destinationLabel: string,
  ): string {
    BROWSER_SECRET_PLACEHOLDER_PATTERN.lastIndex = 0;
    return text.replace(BROWSER_SECRET_PLACEHOLDER_PATTERN, (placeholder) => {
      const entry = this.#vault.lookup(placeholder);
      if (!entry) {
        throw new BrowserSecretPlaceholderError(
          `${placeholder} is not a value this browser session masked (it may come from an earlier session). Read it again from the page or its traffic and use the placeholder you get then.`,
        );
      }
      if (!entry.replayable) {
        throw new BrowserSecretPlaceholderError(
          `${placeholder} stands for a password or one-time code, which can't be sent from a placeholder. Fill it with use_secure_value and its handle instead.`,
          placeholder,
        );
      }
      if (!destination) {
        throw new BrowserSecretPlaceholderError(
          `Couldn't tell which site ${destinationLabel} is on, so ${placeholder} was not sent. Use it in a request to an absolute https URL on ${describeSites(entry.sites)}, or from a tab on that site.`,
        );
      }
      if (!entry.sites.has(destination)) {
        throw new BrowserSecretPlaceholderError(
          `${placeholder} was captured from ${describeSites(entry.sites)} and can only be sent there, not to ${destination}.`,
        );
      }
      if (mode === "script") {
        SCRIPT_URL_PATTERN.lastIndex = 0;
        for (const match of text.matchAll(SCRIPT_URL_PATTERN)) {
          const urlSite = siteOfHost(match[1]!);
          if (urlSite && !entry.sites.has(urlSite)) {
            throw new BrowserSecretPlaceholderError(
              `A page script that uses ${placeholder} may only name URLs on ${describeSites(entry.sites)}; it names ${urlSite}. Use relative URLs for requests from the page.`,
            );
          }
        }
      }
      const real =
        mode === "url"
          ? encodeURIComponent(entry.value)
          : mode === "script"
            ? escapeForScript(entry.value)
            : entry.value;
      this.inserted.set(entry.value, placeholder);
      if (real !== entry.value) this.inserted.set(real, placeholder);
      this.changed = true;
      return real;
    });
  }

  async params(
    action: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!containsBrowserSecretPlaceholder(JSON.stringify(params))) return params;
    const tabId =
      typeof params.tabId === "number" && Number.isSafeInteger(params.tabId)
        ? params.tabId
        : undefined;
    const tabLabel = tabId === undefined ? "the current tab" : `tab ${tabId}`;
    const destinationOf = async (
      url: unknown,
    ): Promise<[string | undefined, string]> =>
      isAbsoluteHttpUrl(url)
        ? [siteOfUrl(url), url]
        : [await this.tabSite(tabId), tabLabel];

    if (action === "authenticated_request_batch" && Array.isArray(params.requests)) {
      const requests: unknown[] = [];
      for (const request of params.requests) {
        if (!isPlainRecord(request)) {
          requests.push(request);
          continue;
        }
        const [site, label] = await destinationOf(request.url);
        requests.push(this.#walk(request, site, label, (key) => (key === "url" ? "url" : "raw")));
      }
      return { ...params, requests };
    }

    let destination: [string | undefined, string];
    if (
      action === "navigate" ||
      action === "tab_new" ||
      action === "authenticated_request"
    ) {
      destination = await destinationOf(params.url);
    } else if (action === "cookies_set") {
      destination = isAbsoluteHttpUrl(params.url)
        ? [siteOfUrl(params.url), params.url]
        : typeof params.domain === "string"
          ? [siteOfHost(params.domain), params.domain]
          : [await this.tabSite(tabId), tabLabel];
    } else {
      destination = [await this.tabSite(tabId), tabLabel];
    }
    const scriptKey =
      action === "evaluate" || action === "evaluate_detached"
        ? "script"
        : action === "waitforfunction"
          ? "expression"
          : undefined;
    const urlKey =
      action === "navigate" ||
      action === "tab_new" ||
      action === "authenticated_request"
        ? "url"
        : undefined;
    return this.#walk(params, destination[0], destination[1], (key, depth) =>
      depth === 0 && key === scriptKey
        ? "script"
        : depth === 0 && key === urlKey
          ? "url"
          : "raw",
    ) as Record<string, unknown>;
  }

  #walk(
    value: unknown,
    destination: string | undefined,
    label: string,
    modeFor: (key: string, depth: number) => SubstitutionMode,
    key = "",
    depth = -1,
  ): unknown {
    if (typeof value === "string") {
      return containsBrowserSecretPlaceholder(value)
        ? this.replace(value, depth >= 0 ? modeFor(key, depth) : "raw", destination, label)
        : value;
    }
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.#walk(item, destination, label, modeFor, key, depth + 1),
      );
    }
    if (!isPlainRecord(value)) return value;
    const next: Record<string, unknown> = {};
    for (const [field, item] of Object.entries(value)) {
      next[field] = this.#walk(item, destination, label, modeFor, field, depth + 1);
    }
    return next;
  }
}

export type BrowserPlaceholderSubstitution = Readonly<{
  args: unknown[];
  inserted: ReadonlyMap<string, string>;
}>;

export const substituteBrowserPlaceholders = async (
  vault: BrowserSecretVault,
  method: string,
  args: readonly unknown[],
  tabSite: TabSiteResolver,
): Promise<BrowserPlaceholderSubstitution | null> => {
  if (method !== "command" && method !== "chain") return null;
  if (!containsBrowserSecretPlaceholder(JSON.stringify(args))) return null;
  const substitution = new Substitution(vault, tabSite);
  if (method === "command") {
    const action = typeof args[0] === "string" ? args[0] : "";
    const params = isPlainRecord(args[1]) ? args[1] : {};
    const next = await substitution.params(action, params);
    return substitution.changed
      ? { args: [args[0], next, ...args.slice(2)], inserted: substitution.inserted }
      : null;
  }
  const steps = Array.isArray(args[0]) ? args[0] : [];
  const nextSteps: unknown[] = [];
  for (const step of steps) {
    if (!isPlainRecord(step) || typeof step.action !== "string") {
      nextSteps.push(step);
      continue;
    }
    const params = isPlainRecord(step.params) ? step.params : {};
    nextSteps.push({ ...step, params: await substitution.params(step.action, params) });
  }
  return substitution.changed
    ? { args: [nextSteps, ...args.slice(1)], inserted: substitution.inserted }
    : null;
};
