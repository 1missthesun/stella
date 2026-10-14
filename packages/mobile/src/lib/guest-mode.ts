import * as SecureStore from "./secure-store";

/** Where builds that offered "Continue without signing in" kept that choice. */
const GUEST_KEY = "stella-mobile_guest-mode";

/** Stella has no guest mode any more; forget an older build's flag. */
export async function clearLegacyGuestMode(): Promise<void> {
  await SecureStore.deleteItemAsync(GUEST_KEY).catch(() => {});
}
