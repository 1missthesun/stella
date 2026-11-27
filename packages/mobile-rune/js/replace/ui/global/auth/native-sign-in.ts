// The phone's sign-in, on the RN app's backend contract (packages/mobile/src/lib/native-auth-client.ts
// and app/(auth)/login.tsx):
// - Google (and Apple where the native sheet can't run): better-auth's social sign-in as a
//   native client (`expo-origin`, a `stella-mobile:` callback), run through the backend's
//   expo-authorization-proxy in ASWebAuthenticationSession. The callback carries a one-time
//   token, redeemed here for the session.
// - Apple: Sign in with Apple's sheet (ASAuthorizationController) with a hashed nonce, and its
//   identity token handed to `signIn.social({ provider: "apple", idToken })`.
// Either way the account session lands in the web build's storage, and the auth state refresh
// takes the app past the sign-in screen.

import { authClient } from "@/global/auth/lib/auth-client";
import { readBrowserSessionToken } from "@/global/auth/services/auth-storage";
import { refreshAuthSession, getAuthSessionSnapshot } from "@/global/auth/services/auth-session";
import { backendUrl } from "@/platform/backend/backend-url";
import { translateNow } from "@/shared/i18n";
import type { NativeSignIn, NativeSignInResult } from "../../../../../../desktop-rune/ui/global/auth/native-sign-in";
import { phoneRequest, PhoneRequestError } from "../../../../../ui/native/app";

/** The scheme the backend trusts for native callbacks (`STELLA_MOBILE_SCHEME`, the RN app's). */
const SCHEME = "stella-mobile";
const CALLBACK_URL = `${SCHEME}:///chat`;
const NATIVE_HEADERS = { "expo-origin": `${SCHEME}://`, "x-skip-oauth-proxy": "true" };
const AUTH_ORIGINS = ["https://auth.stella.sh", "https://auth-dev.stella.sh"];

type SocialResult = { data?: { url?: string; redirect?: boolean } | null; error?: { message?: string; statusText?: string } | null };

const t = (key: string) => translateNow(key);
const errorOf = (r: SocialResult | undefined, fallback: string) => r?.error?.message || r?.error?.statusText || fallback;

const signedIn = () => {
  const user = (getAuthSessionSnapshot().data as { user?: { id?: string; isAnonymous?: boolean | null } } | null | undefined)?.user;
  return Boolean(user?.id && user.isAnonymous !== true);
};

/** The account session the backend just set (`set-auth-token`, which the auth client keeps), made the app's. */
async function adoptSession(): Promise<NativeSignInResult> {
  if (!readBrowserSessionToken()) return { error: t("mobile.login.appleCompleteFailed") };
  authClient.updateSession();
  await refreshAuthSession();
  return signedIn() ? { ok: true } : { error: t("mobile.login.appleCompleteFailed") };
}

async function redeemOneTimeToken(ott: string): Promise<NativeSignInResult> {
  const result = (await authClient.oneTimeToken.verify({ token: ott })) as SocialResult;
  if (result?.error) return { error: errorOf(result, "Sign-in could not complete.") };
  return await adoptSession();
}

/** The social sign-in's provider URL, opened through the backend's proxy (it binds the OAuth state to the web session) in ASWebAuthenticationSession. */
async function webSignIn(provider: "google" | "apple", loginHint: string | null | undefined, startFailed: string): Promise<NativeSignInResult> {
  const result = (await authClient.signIn.social({
    provider,
    callbackURL: CALLBACK_URL,
    disableRedirect: true,
    ...(loginHint ? { loginHint } : {}),
    fetchOptions: { headers: NATIVE_HEADERS },
  })) as SocialResult;
  const authorizationURL = result?.data?.url;
  if (result?.error || !authorizationURL) return { error: errorOf(result, startFailed) };
  const redirectURI = new URL(authorizationURL).searchParams.get("redirect_uri");
  const callbackOrigin = redirectURI ? new URL(redirectURI).origin : null;
  const base = callbackOrigin && [new URL(backendUrl!).origin, ...AUTH_ORIGINS].includes(callbackOrigin) ? callbackOrigin : backendUrl!.replace(/\/+$/, "");
  const proxyURL = `${base}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`;
  let returned: string;
  try {
    returned = (await phoneRequest<{ url: string }>("auth.webSession", { url: proxyURL, callbackScheme: SCHEME })).url;
  } catch (error) {
    if (error instanceof PhoneRequestError && error.code === "canceled") return { canceled: true };
    return { error: error instanceof Error ? error.message : startFailed };
  }
  const url = new URL(returned);
  const failure = url.searchParams.get("error");
  const ott = (url.searchParams.get("ott") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("ott"))?.trim();
  if (!ott) return { error: failure ? `Sign-in failed (${failure}).` : "The sign-in didn't return to Stella." };
  return await redeemOneTimeToken(ott);
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function appleSignIn(): Promise<NativeSignInResult> {
  const raw = hex(__native.random(32));
  const nonce = hex(__native.digest("SHA-256", new TextEncoder().encode(raw)));
  let credential: { identityToken: string };
  try {
    credential = await phoneRequest<{ identityToken: string }>("auth.apple", { nonce });
  } catch (error) {
    if (error instanceof PhoneRequestError && error.code === "canceled") return { canceled: true };
    // No Sign in with Apple here (a build without the entitlement, a device without an Apple
    // Account): Apple's web sign-in, as the RN app uses off iOS.
    if (error instanceof PhoneRequestError && error.code === "unavailable") return await webSignIn("apple", null, t("mobile.login.appleStartFailed"));
    return { error: error instanceof Error ? error.message : t("mobile.login.appleStartFailed") };
  }
  const result = (await authClient.signIn.social({
    provider: "apple",
    idToken: { token: credential.identityToken, nonce },
    fetchOptions: { headers: NATIVE_HEADERS },
  })) as SocialResult;
  if (result?.error) return { error: errorOf(result, t("mobile.login.appleCompleteFailed")) };
  return await adoptSession();
}

const guard = (run: () => Promise<NativeSignInResult>) => async (): Promise<NativeSignInResult> => {
  try {
    return await run();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export type { NativeSignIn, NativeSignInResult };

export const nativeSignIn: NativeSignIn | null = {
  google: (loginHint) => guard(() => webSignIn("google", loginHint, t("mobile.login.googleStartFailed")))(),
  apple: guard(appleSignIn),
};
