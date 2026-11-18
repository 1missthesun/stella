/** Helpers with no computer access (no files, no processes): safe on Stella's server too. */

/** Registrable-ish domain: "accounts.google.com" -> "google.com", "bbc.co.uk" -> "bbc.co.uk". */
const TWO_PART_SUFFIXES = new Set(["co.uk", "com.au", "co.jp", "co.in", "com.br", "co.nz", "co.za", "com.mx", "com.tr", "org.uk", "ac.uk", "gov.uk", "com.cn", "com.sg", "com.hk", "co.kr"]);
export const baseDomain = (host: string): string => {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (/^[\d.]+$/.test(h) || !h.includes(".")) return h;
  const parts = h.split(".");
  const last2 = parts.slice(-2).join(".");
  if (TWO_PART_SUFFIXES.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
};

export const hostOf = (url: string): string | undefined => {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.hostname;
  } catch {
    return undefined;
  }
};

/** Compare dotted versions: -1 if a<b, 0 equal, 1 if a>b. Non-numeric parts compare as 0. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split(/[.\-+ ]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+ ]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
};

export const DAY = 86_400_000;

/** Chrome stores times as microseconds since 1601-01-01. */
export const chromeTimeToMs = (t: number | bigint | null | undefined): number => {
  if (t === null || t === undefined) return 0;
  const n = typeof t === "bigint" ? Number(t) : t;
  return n / 1000 - 11_644_473_600_000;
};
export const msToChromeTime = (ms: number): number => (ms + 11_644_473_600_000) * 1000;

export const fetchJson = async <T = unknown>(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "StellaSecurity/0.1 (+https://stella.sh/security)", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
};

export const fetchText = async (url: string, timeoutMs = 20_000): Promise<string> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "StellaSecurity/0.1 (+https://stella.sh/security)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.text();
};
