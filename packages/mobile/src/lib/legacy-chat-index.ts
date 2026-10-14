import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";

const LEGACY_DB_NAME = "stella-chat-index.db";
const LEGACY_DB_SUFFIXES = ["", "-wal", "-shm", "-journal"];
const LEGACY_STORAGE_KEYS = [
  "stella-mobile-chat-index-rebuild-required-v1",
  "stella-mobile-chat-account-index-cleared-v1",
];

export async function deleteLegacyChatIndex(): Promise<void> {
  let directory: string;
  try {
    directory = (await import("expo-sqlite")).defaultDatabaseDirectory;
  } catch {
    return;
  }
  if (typeof directory !== "string" || !directory) return;
  const directoryUri = directory.startsWith("file://")
    ? directory
    : `file://${directory}`;
  for (const suffix of LEGACY_DB_SUFFIXES) {
    const file = new File(directoryUri, `${LEGACY_DB_NAME}${suffix}`);
    if (file.exists) file.delete();
  }
  await AsyncStorage.multiRemove(LEGACY_STORAGE_KEYS);
}
