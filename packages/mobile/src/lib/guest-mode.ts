import * as SecureStore from "./secure-store";

const GUEST_KEY = "stella-mobile_guest-mode";

export async function clearLegacyGuestMode(): Promise<void> {
  await SecureStore.deleteItemAsync(GUEST_KEY).catch(() => {});
}
