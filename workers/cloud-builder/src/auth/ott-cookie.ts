export const OTT_COOKIE_NAME = "__Host-stella-ott";

const OTT_COOKIE_MAX_AGE_SECONDS = 180;
const OTT_VALUE_PATTERN = /^[A-Za-z0-9._~-]{8,2048}$/;

export const ottCookieHeader = (token: string): string =>
  `${OTT_COOKIE_NAME}=${token}; Max-Age=${OTT_COOKIE_MAX_AGE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;

export const clearOttCookieHeader = `${OTT_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

export const readOttCookie = (headers: Headers | null | undefined): string => {
  const raw = headers?.get("cookie");
  if (!raw) return "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== OTT_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return OTT_VALUE_PATTERN.test(value) ? value : "";
  }
  return "";
};

export const withClearedOttCookie = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", clearOttCookieHeader);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
