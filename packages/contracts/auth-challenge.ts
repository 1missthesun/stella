export const AUTH_CAPTCHA_HEADER = "x-captcha-response" as const;

export const AUTH_CHALLENGE_PAGE_PATH = "/challenge" as const;

export type AuthChallengeClient = "desktop" | "web";
export const AUTH_CHALLENGE_DEEP_LINK_HOST = "turnstile" as const;
export const AUTH_CHALLENGE_TOKEN_PARAM = "token" as const;
export const AUTH_CHALLENGE_STATE_PARAM = "state" as const;

