import { useSyncExternalStore } from "react";

/** The window x of the chat column's edges (the composer's), which the top bar's capsules line up with in wide windows. */
export type ChatColumnEdges = { left: number; right: number };

let edges: ChatColumnEdges | null = null;
const listeners = new Set<() => void>();

export function reportChatColumnEdges(next: ChatColumnEdges) {
  if (edges && Math.abs(edges.left - next.left) < 0.5 && Math.abs(edges.right - next.right) < 0.5) return;
  edges = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const read = () => edges;

export const useChatColumnEdges = () => useSyncExternalStore(subscribe, read, read);
