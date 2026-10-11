import { useCallback, useEffect, useState } from "react";
import type {
  PiChatBrainResult,
  PiChatMoveTarget,
} from "@stella/contracts/pi-chat";

/**
 * Others move Stella too (her own switch, another device, the cloud taking
 * her over from a computer that went away). The host says when what it reads
 * changes (a `brain` event); this reads again now and then for a move no turn
 * here has shown yet.
 */
const REFRESH_MS = 15_000;

const api = () =>
  typeof window === "undefined" ? undefined : window.electronAPI?.piChat;

/** Whether this app can read and move where a conversation's Stella runs. */
export const conversationBrainAvailable = (): boolean => api() !== undefined;

/**
 * Where the open conversation's Stella runs (its brain lease,
 * `@stella/contracts/turn-plane/pi-brain`), and the user moving her there
 * from the picker: the same move as her own `switch_destination`.
 */
export function useConversationBrain(conversationId: string | null) {
  const [state, setState] = useState<{
    conversationId: string;
    brain: PiChatBrainResult;
  } | null>(null);
  const [moving, setMoving] = useState(false);

  const read = useCallback(async () => {
    const chat = api();
    if (!chat || !conversationId) return;
    const brain = (await chat.request({
      op: "brain",
      conversationId,
    })) as PiChatBrainResult;
    setState({ conversationId, brain });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !api()) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void read().catch(() => undefined);
      }
    };
    void read().catch(() => undefined);
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    const unsubscribe = api()?.onEvents(
      ({ conversationId: changed, events }) => {
        if (changed !== conversationId) return;
        for (const event of events) {
          if (event.type === "brain")
            setState({ conversationId, brain: event.brain });
        }
      },
    );
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      unsubscribe?.();
    };
  }, [conversationId, read]);

  const move = useCallback(
    async (target: PiChatMoveTarget): Promise<void> => {
      const chat = api();
      if (!chat || !conversationId) return;
      setMoving(true);
      try {
        const brain = (await chat.request({
          op: "move",
          conversationId,
          target,
        })) as PiChatBrainResult;
        setState({ conversationId, brain });
      } finally {
        setMoving(false);
      }
    },
    [conversationId],
  );

  return {
    brain: state?.conversationId === conversationId ? state.brain : undefined,
    moving,
    refresh: read,
    move,
  };
}
