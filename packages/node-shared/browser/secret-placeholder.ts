/**
 * Stand-ins for credentials masked out of browser output. They are made of
 * URL-unreserved characters so they survive URLs, headers, cookies, form
 * bodies and JSON unchanged, and the hyphens keep them from parsing as a
 * JavaScript identifier, so one outside a string literal is a syntax error
 * rather than a silently different value.
 */
export const BROWSER_SECRET_PLACEHOLDER_PREFIX = "stella-secret-";

const PLACEHOLDER_BODY = "[a-z2-7]{12}";

export const BROWSER_SECRET_PLACEHOLDER_PATTERN = new RegExp(
  `${BROWSER_SECRET_PLACEHOLDER_PREFIX}${PLACEHOLDER_BODY}`,
  "g",
);

const EXACT_PLACEHOLDER = new RegExp(
  `^${BROWSER_SECRET_PLACEHOLDER_PREFIX}${PLACEHOLDER_BODY}$`,
);

export const isBrowserSecretPlaceholder = (value: unknown): boolean =>
  typeof value === "string" && EXACT_PLACEHOLDER.test(value);

export const containsBrowserSecretPlaceholder = (text: string): boolean =>
  text.includes(BROWSER_SECRET_PLACEHOLDER_PREFIX);
