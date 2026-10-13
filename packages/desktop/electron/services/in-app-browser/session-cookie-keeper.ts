import type { Cookie, Session } from "electron";

const KEPT_SESSION_COOKIE_SECONDS = 30 * 24 * 60 * 60;
const FLUSH_DELAY_MS = 1_000;

const cookieUrl = (cookie: Cookie) => {
  const host = String(cookie.domain || "")
    .trim()
    .replace(/^\./, "");
  if (!host || host.includes("/") || host.includes("\0")) return null;
  return `${cookie.secure ? "https" : "http"}://${host}${
    cookie.path?.startsWith("/") ? cookie.path : "/"
  }`;
};

export const keepSessionCookies = (browserSession: Session): (() => void) => {
  if (typeof browserSession.cookies?.on !== "function") return () => {};
  const inFlight = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void browserSession.cookies.flushStore().catch(() => undefined);
    }, FLUSH_DELAY_MS);
    flushTimer.unref?.();
  };
  const onChanged = (
    _event: unknown,
    cookie: Cookie,
    _cause: string,
    removed: boolean,
  ) => {
    scheduleFlush();
    if (removed || !cookie.session || !cookie.name) return;
    const url = cookieUrl(cookie);
    if (!url) return;
    const key = `${cookie.name}\0${cookie.domain}\0${cookie.path}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void browserSession.cookies
      .set({
        url,
        name: cookie.name,
        value: cookie.value,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        path: cookie.path || "/",
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: Math.floor(Date.now() / 1000) + KEPT_SESSION_COOKIE_SECONDS,
      })
      .then(scheduleFlush, () => undefined)
      .finally(() => inFlight.delete(key));
  };
  browserSession.cookies.on("changed", onChanged);
  return () => {
    browserSession.cookies.off("changed", onChanged);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  };
};
