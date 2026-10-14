import { deleteLegacyChatIndex } from "./legacy-chat-index";
import {
  beginAccountChatCleanupIntent,
  finalizeAccountChatCleanup,
  markAccountCanonicalChatCleared,
} from "./chat-account-cleanup-state";
import {
  clearAllChatStorage,
  invalidateChatStorageForAccountCleanup,
} from "./offline-chat-storage";

export async function clearAccountChatData(): Promise<void> {
  const token = await beginAccountChatCleanupIntent();
  invalidateChatStorageForAccountCleanup();
  await deleteLegacyChatIndex();
  await clearAllChatStorage();
  await markAccountCanonicalChatCleared(token);
  if (!(await finalizeAccountChatCleanup(token))) {
    throw new Error("Local chat account cleanup did not finalize");
  }
}
