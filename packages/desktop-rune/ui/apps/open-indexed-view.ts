// Opens a view from the Apps list: its newest version comes from the account's view index
// (owner-store `viewIndex.get`), is handed to the views host the way a conversation's `view` call
// is, under its conversation so its storage syncs as in the chat, and opens in the panel. The host
// runs the local file when this computer has it, else this source. While the app runs, newer
// versions keep arriving from the index and swap in.
import type { IndexedView, IndexedViewSource } from "@stella/contracts/backend/view-index";
import { backendClient } from "@/platform/backend/backend-client";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";

/** How many opened views keep following the index at once; the oldest stops first. */
const MAX_FOLLOWED = 12;
const followed = new Map<string, () => void>();

const offer = (view: IndexedViewSource) => {
  globalThis.stella.views?.offerMessages(
    [
      {
        toolEvents: [
          {
            type: "tool_result",
            timestamp: view.updatedAt,
            payload: {
              toolName: "view",
              details: { filePath: view.filePath, slug: view.slug, title: view.title, source: view.source, createdAt: view.updatedAt, ...(view.data !== undefined ? { data: view.data } : {}) },
            },
          },
        ],
      },
    ],
    view.conversationId,
  );
};

const follow = (id: string) => {
  const existing = followed.get(id);
  if (existing) {
    followed.delete(id);
    followed.set(id, existing);
    return;
  }
  const stop = backendClient.watch(
    "viewIndex.get",
    { id },
    (view) => {
      if (view) offer(view);
    },
    () => undefined,
  );
  followed.set(id, stop);
  while (followed.size > MAX_FOLLOWED) {
    const [oldest, release] = followed.entries().next().value as [string, () => void];
    followed.delete(oldest);
    release();
  }
};

export async function openIndexedView(view: IndexedView): Promise<void> {
  const latest = await backendClient.read("viewIndex.get", { id: view.id }, { timeoutMs: 15_000 });
  if (!latest) throw new Error("This view isn't in your Apps any more.");
  offer(latest);
  openDisplayPayloadTab({ kind: "canvas-html", filePath: latest.filePath, title: latest.title, createdAt: latest.createdAt });
  follow(view.id);
}
