import { emailDir, getEmailStrings } from "./email-i18n.js";

export const buildMagicLinkEmail = (
  logoSrc: string,
  signInUrl: string,
  locale?: string | null,
): string => {
  const strings = getEmailStrings(locale);
  const dir = emailDir(locale);
  const lang = locale && locale.trim() ? locale.trim() : "en";

  return `
<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Mona+Sans:wght@600&family=Manrope:wght@400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f2f4f8;font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f4f8;padding:64px 24px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
          <!-- Logo -->
          <tr>
            <td style="padding-bottom:40px;text-align:center;">
              <img src="${logoSrc}" alt="Stella" width="48" height="48" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:rgba(255,255,255,0.92);border:1px solid rgba(22,22,22,0.08);border-radius:10px;padding:40px 36px;">
              <!-- Title -->
              <h1 style="margin:0 0 6px;font-family:'Mona Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:24px;font-weight:600;font-style:normal;letter-spacing:-0.02em;line-height:1.1;color:#161616;">
                ${strings.signInTitle}
              </h1>
              <p style="margin:0 0 32px;font-size:14px;color:rgba(22,22,22,0.52);line-height:1.55;letter-spacing:-0.01em;">
                ${strings.signInDescription}
              </p>
              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr><td style="border-top:1px solid rgba(22,22,22,0.1);font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${signInUrl}" style="display:inline-block;padding:12px 36px;border:1px solid rgba(22,22,22,0.18);border-radius:6px;background-color:transparent;color:#161616;font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;text-decoration:none;letter-spacing:-0.01em;">
                      ${strings.signInButton}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:28px;text-align:center;">
              <p style="margin:0;font-size:12px;color:rgba(22,22,22,0.35);line-height:1.5;letter-spacing:-0.01em;">
                ${strings.ignoreFooter}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const getMagicLinkSubject = (
  locale: string | null | undefined,
): string => getEmailStrings(locale).subjectMagicLink;

export const NEW_SIGN_IN_SUBJECT = "New sign-in to your Stella account";

export const buildNewSignInAlertEmail = (
  logoSrc: string,
  deviceLabel: string,
  whenLabel: string,
): string => `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f2f4f8;font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f4f8;padding:64px 24px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
          <tr>
            <td style="padding-bottom:40px;text-align:center;">
              <img src="${logoSrc}" alt="Stella" width="48" height="48" style="display:block;margin:0 auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="background-color:rgba(255,255,255,0.92);border:1px solid rgba(22,22,22,0.08);border-radius:10px;padding:40px 36px;">
              <h1 style="margin:0 0 6px;font-size:24px;font-weight:600;color:#161616;">New sign-in</h1>
              <p style="margin:0 0 16px;font-size:14px;color:rgba(22,22,22,0.52);line-height:1.55;">
                Your Stella account was just signed in on a new device.
              </p>
              <p style="margin:0 0 16px;font-size:14px;color:#161616;line-height:1.55;">
                ${deviceLabel}<br>${whenLabel}
              </p>
              <p style="margin:0;font-size:14px;color:rgba(22,22,22,0.52);line-height:1.55;">
                If this was you, no action is needed. If it wasn't, open Stella,
                go to Settings, Account, and sign out every session you don't recognize.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const accountNoticeEmail = (logoSrc: string, title: string, paragraphs: string[]): string => `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f2f4f8;font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f4f8;padding:64px 24px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
          <tr>
            <td style="padding-bottom:40px;text-align:center;">
              <img src="${logoSrc}" alt="Stella" width="48" height="48" style="display:block;margin:0 auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="background-color:rgba(255,255,255,0.92);border:1px solid rgba(22,22,22,0.08);border-radius:10px;padding:40px 36px;">
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:600;color:#161616;">${title}</h1>
              ${paragraphs
                .map(
                  (text) =>
                    `<p style="margin:0 0 16px;font-size:14px;color:rgba(22,22,22,0.72);line-height:1.55;">${text}</p>`,
                )
                .join("\n              ")}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export type AccountDeletionEmailKind = "requested" | "canceled" | "completed";

export const buildAccountDeletionEmail = (
  kind: AccountDeletionEmailKind,
  logoSrc: string,
  dueLabel: string,
): { subject: string; html: string } => {
  if (kind === "requested") {
    return {
      subject: "Your Stella account is scheduled for deletion",
      html: accountNoticeEmail(logoSrc, "Account deletion scheduled", [
        "We received a request to delete your Stella account. You have been signed out on every device, and the account is disabled.",
        `Your account and its data will be deleted after ${dueLabel}. We'll email you when it's done.`,
        "Changed your mind? Sign in to Stella before then and the deletion is canceled. If you didn't ask for this, sign in now to keep your account, then review your sessions in Settings, Account.",
      ]),
    };
  }
  if (kind === "canceled") {
    return {
      subject: "Your Stella account deletion was canceled",
      html: accountNoticeEmail(logoSrc, "Deletion canceled", [
        "You signed in to Stella, so your account will not be deleted and is active again.",
        "Automatic renewal of any subscription stays off. You can turn it back on in Settings, Account.",
      ]),
    };
  }
  return {
    subject: "Your Stella account has been deleted",
    html: accountNoticeEmail(logoSrc, "Account deleted", [
      "Your Stella account and the data stored with it on our servers have been deleted, and any subscription was canceled.",
      "Files on your own devices are not affected. If you sign in again later, you'll start a new, empty account.",
    ]),
  };
};
