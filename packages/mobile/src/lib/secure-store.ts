import * as ExpoSecureStore from "expo-secure-store";
import { launchServer, noteScopedKey, scopedKeyFor } from "./server-registry";

/**
 * SecureStore with keychain items readable after the first unlock since boot.
 * CarPlay usually launches Stella with the iPhone locked, and the default
 * "when unlocked" accessibility hides the session token and consent flags
 * from that launch.
 *
 * Keys belong to the server this launch talks to: on a self-hosted server
 * each key gets that server's prefix, so sessions, consent and pairings
 * never cross servers. Stella's hosted service keeps the unprefixed keys.
 */
const options: ExpoSecureStore.SecureStoreOptions = {
  keychainAccessible: ExpoSecureStore.AFTER_FIRST_UNLOCK,
};

const scoped = (key: string) => scopedKeyFor(launchServer.id, key);

const noteWrite = (key: string) => noteScopedKey(launchServer.id, scoped(key));

export const getItem = (key: string) => ExpoSecureStore.getItem(scoped(key), options);

export const getItemAsync = (key: string) =>
  ExpoSecureStore.getItemAsync(scoped(key), options);

export const setItem = (key: string, value: string) => {
  noteWrite(key);
  return ExpoSecureStore.setItem(scoped(key), value, options);
};

export const setItemAsync = (key: string, value: string) => {
  noteWrite(key);
  return ExpoSecureStore.setItemAsync(scoped(key), value, options);
};

export const deleteItemAsync = (key: string) =>
  ExpoSecureStore.deleteItemAsync(scoped(key), options);

/** Write a key for another server (pairing stores the new session first). */
export const setItemForServerAsync = (
  serverId: string,
  key: string,
  value: string,
) => {
  const target = scopedKeyFor(serverId, key);
  noteScopedKey(serverId, target);
  return ExpoSecureStore.setItemAsync(target, value, options);
};
