import * as ExpoSecureStore from "expo-secure-store";

/**
 * SecureStore with keychain items readable after the first unlock since boot.
 * CarPlay usually launches Stella with the iPhone locked, and the default
 * "when unlocked" accessibility hides the session token and consent flags
 * from that launch.
 */
const options: ExpoSecureStore.SecureStoreOptions = {
  keychainAccessible: ExpoSecureStore.AFTER_FIRST_UNLOCK,
};

export const getItem = (key: string) => ExpoSecureStore.getItem(key, options);

export const getItemAsync = (key: string) => ExpoSecureStore.getItemAsync(key, options);

export const setItem = (key: string, value: string) =>
  ExpoSecureStore.setItem(key, value, options);

export const setItemAsync = (key: string, value: string) =>
  ExpoSecureStore.setItemAsync(key, value, options);

export const deleteItemAsync = (key: string) => ExpoSecureStore.deleteItemAsync(key, options);
