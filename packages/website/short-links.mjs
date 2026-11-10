// stella.sh/r/<source>: a 302 to the home page that counts the hit per source
// in Workers Analytics Engine (dataset bound as SHORT_LINKS). Nothing about the
// visitor is stored beyond the source, their country and the referring host.

const SOURCES = new Set([
  "tiktok",
  "youtube",
  "shorts",
  "reels",
  "instagram",
  "x",
  "threads",
  "bluesky",
  "reddit",
  "facebook",
  "linkedin",
  "discord",
  "alternativeto",
  "aur",
  "producthunt",
  "github",
  "newsletter",
  "email",
  "podcast",
  "qr",
  "bio",
  "bringyoursubs",
  "futuretools",
  "rundown",
  "vellum",
  "simular",
  "goodday",
  "lindy",
  "guidy",
  "chatai",
  "winget",
]);

const ALIASES = { twitter: "x", yt: "youtube", ig: "instagram", tt: "tiktok", fb: "facebook" };

const SHORT_LINK = /^\/r\/([^/]{1,64})\/?$/;

/** The counted source for a /r/ path, "other" for unknown ones, null when not a short link. */
export const shortLinkSource = (pathname) => {
  const match = SHORT_LINK.exec(pathname);
  if (!match) return null;
  let raw;
  try {
    raw = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return "other";
  }
  const source = ALIASES[raw] ?? raw;
  return SOURCES.has(source) ? source : "other";
};

const referrerHost = (request) => {
  try {
    const host = new URL(request.headers.get("Referer") ?? "").hostname.toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

export const shortLinkResponse = (request, env, source) => {
  try {
    env?.SHORT_LINKS?.writeDataPoint({
      indexes: [source],
      blobs: [source, String(request.cf?.country ?? ""), referrerHost(request)],
      doubles: [1],
    });
  } catch {
    // Counting must never block the redirect.
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Robots-Tag": "noindex",
    },
  });
};
