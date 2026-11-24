import * as ExpoSecureStore from "expo-secure-store";
import { launchServer, noteScopedKey, scopedKeyFor } from "./server-registry";

/**
 * CarPlay usually launches Stella with the iPhone locked, and the default
 * "when unlocked" keychain accessibility hides the session token and consent
 * flags from that launch.
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

export const setItemForServerAsync = (
  serverId: string,
  key: string,
  value: string,
) => {
  const target = scopedKeyFor(serverId, key);
  noteScopedKey(serverId, target);
  return ExpoSecureStore.setItemAsync(target, value, options);
};

const deviceOnlyOptions: ExpoSecureStore.SecureStoreOptions = {
  keychainAccessible: ExpoSecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const getDeviceOnlyItemAsync = (key: string) =>
  ExpoSecureStore.getItemAsync(scoped(key), deviceOnlyOptions);

export const setDeviceOnlyItemAsync = (key: string, value: string) => {
  noteWrite(key);
  return ExpoSecureStore.setItemAsync(scoped(key), value, deviceOnlyOptions);
};

export const deleteDeviceOnlyItemAsync = (key: string) =>
  ExpoSecureStore.deleteItemAsync(scoped(key), deviceOnlyOptions);
