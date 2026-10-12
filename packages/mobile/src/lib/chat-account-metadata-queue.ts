import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadAccountChatCleanupIntent } from "./chat-account-cleanup-state";

const TRANSCRIPT_CLEANUP_REQUIRED_KEY =
  "stella-mobile-transcript-cleanup-required-v1";

let cleanupInProgress = false;

const durableCleanupPending = async (): Promise<boolean> =>
  Boolean(await loadAccountChatCleanupIntent()) ||
  (await AsyncStorage.getItem(TRANSCRIPT_CLEANUP_REQUIRED_KEY)) === "1";

export function beginAccountChatMetadataCleanup(): void {
  cleanupInProgress = true;
}

export function finishAccountChatMetadataCleanup(): void {
  cleanupInProgress = false;
}

export async function accountChatMetadataReadsBlocked(): Promise<boolean> {
  return cleanupInProgress || durableCleanupPending();
}
