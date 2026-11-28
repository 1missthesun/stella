// Which links leave a view, the same on every platform: a text's `href` opens web links, and
// `stella.openUrl` web, mail, phone and message links. Nothing else (file:, javascript:, app or OS
// handler schemes) is handed to the browser or the system.

const HREF_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
const OPEN_URL_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

const parse = (url: unknown, allowed: ReadonlySet<string>): URL | null => {
  try {
    const parsed = new URL(String(url ?? "").trim());
    return allowed.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
};

/** A text `href` a view may open, or null. */
export const viewHrefUrl = (href: unknown): URL | null => parse(href, HREF_PROTOCOLS);

/** A URL `stella.openUrl` (and the web host's link opening) may open, or null. */
export const viewOpenableUrl = (url: unknown): URL | null => parse(url, OPEN_URL_PROTOCOLS);

/** `viewOpenableUrl`, throwing what a view sees when it isn't. */
export const requireViewOpenableUrl = (url: unknown): URL => {
  const parsed = viewOpenableUrl(url);
  if (parsed) return parsed;
  let protocol = "that kind of link";
  try {
    protocol = new URL(String(url ?? "")).protocol;
  } catch {
    // Not a URL at all.
  }
  throw new Error(`openUrl opens web, mail and phone links, not ${protocol}`);
};
