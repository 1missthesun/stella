import { useEffect } from "react";
import { uiState } from "@/platform/ui-state";
import { seedPiChatWelcome } from "@/features/chat/pi/pi-chat-store";
import { runtimeUnavailable } from "@/features/chat/pi/desktop-send-outbox";

// A new install goes through setup, then opens on its chat, whose first
// message is Stella's short welcome with the Meet Stella guide under it.

const WELCOME_PENDING_KEY = "stella-welcome-pending";

// Called when a new install starts setup: its first chat gets the welcome.
export const beginFirstRun = (): void => {
  uiState.setItem(WELCOME_PENDING_KEY, "1");
};

const seeding = new Set<string>();
const RETRY_MS = [250, 500, 1_000, 2_000, 4_000];

// The welcome goes into the first chat this install opens. A chat kept on this
// computer gets it here; an account's chat already has the cloud's. A first
// launch often opens the chat before Stella's runtime has connected, so the
// welcome waits for it.
export function useFirstRunWelcome(conversationId: string | null): void {
  useEffect(() => {
    if (!conversationId || uiState.getItem(WELCOME_PENDING_KEY) !== "1") return;
    if (!conversationId.startsWith("local_")) {
      uiState.removeItem(WELCOME_PENDING_KEY);
      return;
    }
    if (seeding.has(conversationId)) return;
    seeding.add(conversationId);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const retry = () => {
      if (!live) return;
      timer = setTimeout(seed, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
      attempt += 1;
    };
    const seed = () => {
      if (!live || uiState.getItem(WELCOME_PENDING_KEY) !== "1") return;
      void seedPiChatWelcome(conversationId).then(
        (reached) => {
          if (reached === null) return retry();
          uiState.removeItem(WELCOME_PENDING_KEY);
        },
        (error: unknown) => {
          if (runtimeUnavailable(error)) return retry();
          console.warn("[first-run] Couldn't add the welcome", error);
        },
      );
    };
    seed();
    return () => {
      live = false;
      clearTimeout(timer);
      seeding.delete(conversationId);
    };
  }, [conversationId]);
}
