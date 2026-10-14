import type { useRouter } from "expo-router";
import { setPendingShare } from "./pending-share";

export function startChatWith(
  router: ReturnType<typeof useRouter>,
  text: string,
): void {
  setPendingShare({ text });
  router.dismissTo("/chat");
}
