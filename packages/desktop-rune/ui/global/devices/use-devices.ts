import { useSyncExternalStore } from "react";
import type { P2pApi, P2pComputer, P2pPeers } from "@stella/contracts/p2p";

const EMPTY: P2pPeers = { devices: [], computers: [] };
const noop = () => () => {};

export const p2p = (): P2pApi | null => globalThis.stella?.host?.p2p ?? null;

export const useDevices = (): P2pPeers => {
  const api = p2p();
  return useSyncExternalStore(api ? api.subscribe : noop, api ? api.peers : () => EMPTY, () => EMPTY);
};

/** The computer whose chat this is, when it's a paired computer's. */
export const useChatComputer = (conversationId: string | null | undefined): P2pComputer | null => {
  const { computers } = useDevices();
  const computer = p2p()?.computerForConversation(conversationId) ?? null;
  return computer ? (computers.find((c) => c.id === computer.id) ?? computer) : null;
};

export const isPhone = (platform: string) => /ios|iphone|ipad|android/i.test(platform);
