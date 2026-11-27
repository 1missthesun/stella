// This computer's device link: the engine's `p2p.*` commands (crate stella-p2p) as a P2pTransport,
// and the paired devices and computers as the UI sees them, kept current from the link's events.

import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { P2pComputer, P2pDevice, P2pNodeEvent, P2pPeers, P2pStatus, P2pTransport } from "@stella/contracts/p2p";
import { onEngineEvent, request } from "../../bridge";

export const p2pDataDir = () => join(process.env.STELLA_DATA_DIR || join(homedir(), ".stella"), "p2p");

export const computerName = () => {
  const name = (process.env.STELLA_P2P_NAME || hostname().replace(/\.local$/i, "")).trim();
  return name || "Computer";
};

let started: Promise<P2pStatus> | null = null;

export const engineTransport: P2pTransport = {
  command: async <T>(name: string, args: Record<string, unknown> = {}) => {
    await startLink();
    return await request<T>(`p2p.${name}`, args);
  },
  on: (listener) => onEngineEvent("p2p", ({ t: _t, ...event }) => listener(event as P2pNodeEvent)),
};

export const startLink = (): Promise<P2pStatus> =>
  (started ??= request<P2pStatus>("p2p.start", {
    dataDir: p2pDataDir(),
    name: computerName(),
    platform: process.platform,
    relay: process.env.STELLA_P2P_RELAY || "default",
  }).catch((error: unknown) => {
    started = null;
    throw error;
  }));

type Raw = {
  devices: (Omit<P2pDevice, "connected"> & { connected?: boolean })[];
  computers: (Omit<P2pComputer, "link"> & { link?: P2pComputer["link"] })[];
};

/** Paired devices and computers, refreshed whenever one of them changes. */
export const createPeerStore = (transport: P2pTransport) => {
  let peers: P2pPeers = { devices: [], computers: [] };
  const listeners = new Set<() => void>();
  let refreshing: Promise<void> | null = null;
  let again = false;

  const refresh = (): Promise<void> => {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = transport
      .command<Raw>("peers")
      .then((raw) => {
        peers = {
          devices: raw.devices.map((d) => ({ ...d, connected: Boolean(d.connected) })),
          computers: raw.computers.map((c) => ({ ...c, link: c.link ?? { state: "idle" } })),
        };
        for (const listener of listeners) listener();
      })
      .catch(() => undefined)
      .finally(() => {
        refreshing = null;
        if (again) {
          again = false;
          void refresh();
        }
      });
    return refreshing;
  };

  transport.on((event) => {
    if (event.kind !== "computer" && event.kind !== "device") return;
    if (event.kind === "computer") {
      const { kind: _kind, id, name, ...link } = event;
      const known = peers.computers.find((c) => c.id === id);
      if (known && link.state !== "paired" && link.state !== "forgotten") {
        peers = {
          ...peers,
          computers: peers.computers.map((c) => (c.id === id ? { ...c, ...(name ? { name } : {}), link: link as P2pComputer["link"] } : c)),
        };
        for (const listener of listeners) listener();
        return;
      }
    }
    void refresh();
  });

  return {
    refresh,
    get: () => peers,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export type PeerStore = ReturnType<typeof createPeerStore>;
