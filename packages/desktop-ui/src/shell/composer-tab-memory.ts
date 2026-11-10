import type { ChatContext } from "@/shared/types/electron";
import { viewAtom } from "@/platform/view-state/view-state";

export type TabComposerMemory = {
  message: string;
  chatContext: ChatContext | null;
  selectedText: string | null;
};

type TabComposerText = Pick<TabComposerMemory, "message" | "selectedText">;

const MAX_RETAINED_TABS = 20;

const texts = viewAtom<Record<string, TabComposerText>>("composer.tabs", {});
const contexts = new Map<string, ChatContext | null>();

/**
 * What each open conversation's composer held when the user left it. The
 * text survives reloads and restarts; attachments of a conversation that is
 * not on screen are large and stay in this page's memory only.
 */
export const composerTabMemory = {
  get(conversationId: string): TabComposerMemory | undefined {
    const text = texts.get()[conversationId];
    return text
      ? { ...text, chatContext: contexts.get(conversationId) ?? null }
      : undefined;
  },
  set(conversationId: string, memory: TabComposerMemory) {
    const { chatContext, ...text } = memory;
    texts.set((known) =>
      Object.fromEntries(
        [
          ...Object.entries(known).filter(([id]) => id !== conversationId),
          [conversationId, text] as const,
        ].slice(-MAX_RETAINED_TABS),
      ),
    );
    contexts.set(conversationId, chatContext);
    const kept = texts.get();
    for (const id of contexts.keys()) {
      if (!(id in kept)) contexts.delete(id);
    }
  },
  /** The memory of a conversation the user is returning to; what they do there replaces it. */
  take(conversationId: string): TabComposerMemory | undefined {
    const memory = composerTabMemory.get(conversationId);
    if (!memory) return undefined;
    texts.set(({ [conversationId]: _returned, ...others }) => others);
    contexts.delete(conversationId);
    return memory;
  },
  keepOnly(openConversationIds: ReadonlySet<string>) {
    texts.set((known) => {
      const kept = Object.entries(known).filter(([id]) =>
        openConversationIds.has(id),
      );
      return kept.length === Object.keys(known).length
        ? known
        : Object.fromEntries(kept);
    });
    for (const id of contexts.keys()) {
      if (!openConversationIds.has(id)) contexts.delete(id);
    }
  },
  clear() {
    texts.set({});
    contexts.clear();
  },
};
