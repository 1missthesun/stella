import { shell } from "electron";
const COMPOSIO_OAUTH_HOSTS = new Set([
    "app.composio.dev",
    "connect.composio.dev",
    "backend.composio.dev",
]);
// Stella's own Google sign-in: Google's consent page, returning to a Stella
// server's Google callback (which only shows a code the app redeems).
const STELLA_GOOGLE_CALLBACK_PATH = "/api/google/oauth_callback";
const isStellaGoogleOAuthUrl = (parsed) => {
    if (parsed.hostname !== "accounts.google.com" || !parsed.pathname.startsWith("/o/oauth2/")) {
        return false;
    }
    try {
        const redirect = new URL(parsed.searchParams.get("redirect_uri") ?? "");
        return redirect.protocol === "https:" && redirect.pathname === STELLA_GOOGLE_CALLBACK_PATH;
    }
    catch {
        return false;
    }
};
export const isApprovedComposioOAuthUrl = (value) => {
    try {
        const parsed = new URL(value);
        return (parsed.protocol === "https:" &&
            (COMPOSIO_OAUTH_HOSTS.has(parsed.hostname) || isStellaGoogleOAuthUrl(parsed)));
    }
    catch {
        return false;
    }
};
export class ConnectorOAuthService {
    async requestExternalOAuthApproval(payload) {
        if (!isApprovedComposioOAuthUrl(payload.resourceUrl)) {
            return { ok: false, reason: "untrusted_oauth_url" };
        }
        try {
            await shell.openExternal(payload.resourceUrl);
            return { ok: true };
        }
        catch (error) {
            return {
                ok: false,
                reason: error instanceof Error && error.message
                    ? error.message
                    : `Could not open ${payload.displayName} authorization.`,
            };
        }
    }
}
