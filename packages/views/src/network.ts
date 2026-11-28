// Which network addresses a view's `stella.fetch` may reach: the public internet only. Pure, so
// the desktop (which checks every address it connects to) and the web (which can only check what
// the URL names) share it.

const v4Octets = (address: string): number[] | null => {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/u.test(part) ? Number(part) : Number.NaN));
  return octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) ? octets : null;
};

/** IPv4 ranges that aren't the public internet: [first octets as a number, prefix length]. */
const PRIVATE_V4: ReadonlyArray<[number, number]> = [
  [0x00000000, 8], // "this network"
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT (Tailscale)
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0586300, 24], // 6to4 relay anycast
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved, broadcast
];

const isPublicV4 = (octets: number[]): boolean => {
  const value = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  return !PRIVATE_V4.some(([base, bits]) => (value & ((~0 << (32 - bits)) >>> 0)) >>> 0 === base);
};

/** An IPv6 address as eight 16-bit groups, or null. */
const v6Groups = (input: string): number[] | null => {
  let address = input.replace(/^\[|\]$/gu, "").split("%")[0]!.toLowerCase();
  let tail: number[] = [];
  const lastColon = address.lastIndexOf(":");
  if (address.slice(lastColon + 1).includes(".")) {
    const v4 = v4Octets(address.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    address = `${address.slice(0, lastColon + 1)}${tail.length ? "0:0" : ""}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []).map((g) => (/^[0-9a-f]{1,4}$/u.test(g) ? parseInt(g, 16) : Number.NaN));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...rest];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g))) return null;
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups;
};

const embeddedV4 = (high: number, low: number): number[] => [high >> 8, high & 0xff, low >> 8, low & 0xff];

const isPublicV6 = (g: number[]): boolean => {
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(8)) return false; // ::
  if (allZeroUntil(7) && g[7] === 1) return false; // ::1
  if (allZeroUntil(5) && g[5] === 0xffff) return isPublicV4(embeddedV4(g[6]!, g[7]!)); // IPv4-mapped
  if (allZeroUntil(4) && g[4] === 0xffff && g[5] === 0) return isPublicV4(embeddedV4(g[6]!, g[7]!)); // IPv4-translated
  if (allZeroUntil(6)) return false; // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicV4(embeddedV4(g[6]!, g[7]!)); // NAT64
  if (g[0] === 0x2002) return isPublicV4(embeddedV4(g[1]!, g[2]!)); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo: can tunnel to anything
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return false; // multicast
  return true;
};

/** Whether an IP address (v4 or v6, bracketed or not) is on the public internet. Anything that isn't an IP is not. */
export const isPublicAddress = (address: string): boolean => {
  const v4 = v4Octets(address);
  if (v4) return isPublicV4(v4);
  const v6 = v6Groups(address);
  return v6 ? isPublicV6(v6) : false;
};

/** Whether a string is an IP address literal (v4, or v6 with or without brackets). */
export const isIpLiteral = (host: string): boolean => v4Octets(host) !== null || (host.includes(":") && v6Groups(host) !== null);

/** Names that never resolve to the public internet. */
const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)\.?$/iu;

/**
 * Whether a URL's host may be public, judged from the host alone: an IP literal must be public, and
 * names such as `localhost` and `*.local` aren't. A name that passes still has to resolve to public
 * addresses, which only a host that resolves names (the desktop) can check.
 */
export const mayBePublicHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/gu, "");
  if (!host) return false;
  if (isIpLiteral(host)) return isPublicAddress(host);
  return !LOCAL_NAME.test(host) && host.includes(".");
};
