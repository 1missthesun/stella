// Sign-in the platform runs itself. The phone replaces this module
// (packages/mobile-rune/js/replace/ui/global/auth/native-sign-in.ts): Google in the system's
// web-auth sheet and Sign in with Apple's own sheet. Desktop has none: Google goes through the
// browser handoff in AuthDialog.

export type NativeSignInResult = { ok: true } | { canceled: true } | { error: string };

export type NativeSignIn = {
  google(loginHint?: string | null): Promise<NativeSignInResult>;
  apple: (() => Promise<NativeSignInResult>) | null;
};

export const nativeSignIn: NativeSignIn | null = null;
