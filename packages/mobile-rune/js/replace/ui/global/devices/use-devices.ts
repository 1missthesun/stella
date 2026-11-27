// The phone's stand-in for desktop-rune/ui/global/devices/use-devices.ts: the device link is the
// phone's own (js/p2p.ts, a device's half), not a desktop host's `stella.host.p2p`.
import { useSyncExternalStore } from "react";
import type { P2pApi, P2pComputer, P2pPeers } from "@stella/contracts/p2p";
import { phoneP2p } from "../../../../p2p";

const EMPTY: P2pPeers = { devices: [], computers: [] };

export const p2p = (): P2pApi | null => phoneP2p;

export const useDevices = (): P2pPeers => useSyncExternalStore(phoneP2p.subscribe, phoneP2p.peers, () => EMPTY);

/** The computer whose chat this is, when it's a paired computer's. */
export const useChatComputer = (conversationId: string | null | undefined): P2pComputer | null => {
  const { computers } = useDevices();
  const computer = phoneP2p.computerForConversation(conversationId);
  return computer ? (computers.find((c) => c.id === computer.id) ?? computer) : null;
};

export const isPhone = (platform: string) => /ios|iphone|ipad|android/i.test(platform);
