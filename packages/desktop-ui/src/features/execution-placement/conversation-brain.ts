import { useCallback, useEffect, useState } from "react";
import type {
  PiChatBrainResult,
  PiChatMoveTarget,
} from "@stella/contracts/pi-chat";
import { onConversationBrainChanged } from "./conversation-brain-signal";

/**
 * Others move Stella too (her own switch, another device, the cloud taking
 * her over from a computer that went away). The host says when what it reads
 * changes (a `brain` event), and the conversation's socket says when the
 * record changed (`onConversationBrainChanged`); this reads again on either,
 * and when the window regains focus, rather than on a timer.
 */

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

  const read = useCallback(
    async (fresh = false) => {
      const chat = api();
      if (!chat || !conversationId) return;
      const brain = (await chat.request({
        op: "brain",
        conversationId,
        ...(fresh ? { fresh: true } : {}),
      })) as PiChatBrainResult;
      setState({ conversationId, brain });
    },
    [conversationId],
  );

  useEffect(() => {
    if (!conversationId || !api()) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void read().catch(() => undefined);
      }
    };
    void read().catch(() => undefined);
    const stopSignal = onConversationBrainChanged((changed) => {
      if (changed === conversationId) void read(true).catch(() => undefined);
    });
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
      stopSignal();
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
    refresh: () => read(),
    move,
  };
}
