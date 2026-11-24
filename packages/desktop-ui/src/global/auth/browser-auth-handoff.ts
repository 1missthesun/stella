export const AUTH_HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,2048}$/;

export type BrowserAuthHandoffResult = "none" | "redeemed" | "failed";

type BrowserHandoffLocation = Pick<Location, "hash" | "pathname" | "search">;

type BrowserHandoffHistory = Pick<History, "replaceState" | "state">;

export const consumeBrowserAuthHandoffToken = (
  location: BrowserHandoffLocation,
  history: BrowserHandoffHistory,
): string | null => {
  const rawFragment = location.hash.replace(/^#\??/, "");
  if (!rawFragment) {
    return null;
  }

  const params = new URLSearchParams(rawFragment);
  if (!params.has("ott")) {
    return null;
  }

  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`,
  );

  const tokens = params.getAll("ott");
  if (tokens.length !== 1) {
    return null;
  }

  const token = tokens[0] ?? "";
  return AUTH_HANDOFF_TOKEN_PATTERN.test(token) ? token : null;
};

