// The phone's signed-out screen, in place of the desktop's centred sign-in card: the phone app's
// login layout (packages/mobile app/(auth)/login.tsx). A headline fills the top, and the ways in sit
// at the bottom within thumb reach, riding up with the keyboard. Nothing is focused on open, so the
// keyboard stays down until the email field is tapped.
import { lazy, Suspense, useCallback, useState } from "react";
import { useT } from "@/shared/i18n";
import type { LegalDocument } from "@/global/legal/legal-text";
import { T } from "../../../../../../../desktop-rune/ui/kit/compat";
import { MagicLinkAuthFlow } from "../../../../../../../desktop-rune/ui/global/auth/MagicLinkAuthFlow";
import { nativeSignIn, type NativeSignInResult } from "../../../../../../../desktop-rune/ui/global/auth/native-sign-in";
import { alpha, font, look, sheet, useTokens } from "../../../../../../../desktop-rune/ui/theme";
import { usePhoneInsets } from "../../../../../../ui/phone/insets";

const LegalDialog = lazy(() => import("../../../../../../../desktop-rune/ui/global/legal/LegalDialog").then((m) => ({ default: m.LegalDialog })));

const SIDE = 28;
const CONTROL_H = 54;
const CONTROL_RADIUS = 14;

const GOOGLE_G =
  '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.89 2.69-6.62Z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.95-2.18l-2.91-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33Z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>';
const APPLE_LOGO =
  '<path fill="currentColor" d="M16.37 12.6c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.8 1.3 10.35.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.29-1.27 3.14-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.73-4.13ZM13.79 4.97c.72-.87 1.2-2.07 1.07-3.27-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.46Z"/>';

const useSignInLook = sheet((c, t) => ({
  social: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS, border: c.border, fill: t.dark ? alpha(c.foreground, 0.06) : c.background, align: "center", justify: "center", gap: 10, color: c.textStrong },
  apple: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS, fill: t.dark ? "#ffffff" : "#000000", align: "center", justify: "center", gap: 10, color: t.dark ? "#000000" : "#ffffff" },
  divider: { w: "full", align: "center", gap: 10, py: 2 },
  dividerLine: { grow: 1, h: 1, fill: c.border },
  form: { gap: 12, w: "full" },
  input: { size: 17, h: CONTROL_H, radius: CONTROL_RADIUS, px: 18 },
  inputWrapper: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS },
  button: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS, justify: "center", size: 17, weight: 600 },
  extras: { opacity: 0, motion: { dur: 0.28 } },
  extrasOpen: { mt: 4, opacity: 1 },
  extrasInner: { clip: 0, minH: 0, gap: 12 },
  sent: { family: "sans", textAlign: "center", size: 15, lh: 1.4, color: c.mutedForeground },
  openInbox: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS, justify: "center" },
  error: { family: "sans", textAlign: "center", size: 15, lh: 1.4, color: c.destructive },
}));

type Pending = "apple" | "google" | null;

export function SignInScreen() {
  const t = useT();
  const tokens = useTokens();
  const s = useSignInLook();
  const insets = usePhoneInsets();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDocument | null>(null);

  const run = useCallback(
    async (kind: Exclude<Pending, null>, start: () => Promise<NativeSignInResult>) => {
      setError(null);
      setPending(kind);
      try {
        const result = await start();
        if ("error" in result) setError(result.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : t(kind === "apple" ? "mobile.login.appleStartFailed" : "mobile.login.googleStartFailed"));
      } finally {
        setPending(null);
      }
    },
    [t],
  );

  const apple = nativeSignIn?.apple ?? null;
  const google = nativeSignIn?.google ?? null;
  const busy = pending !== null;
  const muted = tokens.c.mutedForeground;
  const bottom = Math.max(insets.bottom, insets.keyboard) + 16;

  return (
    <col id="phone-sign-in" fixed inset={0} fill={tokens.c.background} pt={insets.top} pb={bottom} px={SIDE}>
      <col w="full" grow={1} minH={180} justify="center" gap={14} py={24}>
        <text role="heading" {...look(36, 600, { lh: 42 / 36, em: -2 / 36, family: font.display })} color={tokens.c.textStrong}>
          {t("mobile.login.heroTitle")}
        </text>
        <text {...look(17, 400, { lh: 24 / 17, em: -0.3 / 17 })} color={muted}>
          {t("mobile.login.heroBody")}
        </text>
      </col>
      <col w="full" gap={12}>
        {apple ? (
          <box id="phone-sign-in-apple" role="button" label={t("mobile.login.continueWithApple")} {...s.apple} opacity={busy && pending !== "apple" ? 0.6 : 1} pressFill={tokens.dark ? "#e6e6e6" : "#222222"} onPress={busy ? undefined : () => void run("apple", apple)}>
            <icon svg={APPLE_LOGO} name="auth/apple-logo" view={24} size={19} color={tokens.dark ? "#000000" : "#ffffff"} inert />
            <text {...look(17, 600, { em: -0.3 / 17 })} color={tokens.dark ? "#000000" : "#ffffff"}>
              {pending === "apple" ? t("mobile.login.openingApple") : t("mobile.login.continueWithApple")}
            </text>
          </box>
        ) : null}
        {google ? (
          <box id="phone-sign-in-google" role="button" label={t("mobile.login.continueWithGoogle")} {...s.social} opacity={busy && pending !== "google" ? 0.6 : 1} pressFill={alpha(tokens.c.foreground, 0.08)} onPress={busy ? undefined : () => void run("google", () => google(null))}>
            <icon svg={GOOGLE_G} name="auth/google-g" view={18} size={18} inert />
            <text {...look(17, 600, { em: -0.3 / 17 })} color={tokens.c.textStrong}>
              {pending === "google" ? t("mobile.login.openingGoogle") : t("mobile.login.continueWithGoogle")}
            </text>
          </box>
        ) : null}
        {error ? (
          <text w="full" textAlign="center" {...look(15, 400, { lh: 21 / 15 })} color={tokens.c.destructive}>
            {error}
          </text>
        ) : null}
        {apple || google ? (
          <row {...s.divider}>
            <box {...s.dividerLine} />
            <text {...look(11, 400, { em: 0 })} mono textCase="upper" color={muted}>
              {t("mobile.login.orUseEmail")}
            </text>
            <box {...s.dividerLine} />
          </row>
        ) : null}
        <MagicLinkAuthFlow
          hideEmailLabel
          inputVariant="normal"
          emailPlaceholder={t("mobile.login.emailPlaceholder")}
          buttonVariant="primary"
          buttonSize="large"
          submitLabel={t("common.continue")}
          sendingLabel={t("mobile.login.sending")}
          resendLabel={t("mobile.login.resend")}
          sentMessage={t("mobile.login.checkInbox")}
          styles={{ form: s.form, input: s.input, inputWrapper: s.inputWrapper, button: s.button, extras: s.extras, extrasOpen: s.extrasOpen, extrasInner: s.extrasInner, sent: s.sent, openInbox: s.openInbox, error: s.error }}
        />
        <T w="full" size={12} lh={17 / 12} textAlign="center" color={muted} mt={4}>
          {t("mobile.login.legalPrefix")}
          <T underline color={tokens.c.foreground} onPress={() => setLegal("terms")}>{t("mobile.login.legalTerms")}</T>
          {t("mobile.login.legalConjunction")}
          <T underline color={tokens.c.foreground} onPress={() => setLegal("privacy")}>{t("mobile.login.legalPrivacy")}</T>
          {t("mobile.login.legalSuffix")}
        </T>
      </col>
      {legal ? (
        <Suspense fallback={null}>
          <LegalDialog document={legal} onOpenChange={(open) => { if (!open) setLegal(null); }} />
        </Suspense>
      ) : null}
    </col>
  );
}
