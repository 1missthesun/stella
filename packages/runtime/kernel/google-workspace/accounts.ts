import type { ConnectorAccountProvider } from "../connectors/accounts.js";

export const GOOGLE_WORKSPACE_PROVIDER = "google-workspace";

const GMAIL_PROFILE_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";

const readGoogleAccountEmail = async (accessToken: string) => {
  const response = await fetch(GMAIL_PROFILE_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    emailAddress?: unknown;
  } | null;
  return typeof body?.emailAddress === "string" &&
    body.emailAddress.includes("@")
    ? body.emailAddress.trim().toLowerCase()
    : null;
};

export const GOOGLE_WORKSPACE_ACCOUNTS: ConnectorAccountProvider = {
  provider: GOOGLE_WORKSPACE_PROVIDER,
  legacyTokenKey: GOOGLE_WORKSPACE_PROVIDER,
  displayName: "Google",
  resolveEmail: (payload) => readGoogleAccountEmail(payload.accessToken),
};

export const newGoogleWorkspacePendingTokenKey = () =>
  `${GOOGLE_WORKSPACE_PROVIDER}:pending-${crypto.randomUUID()}`;
