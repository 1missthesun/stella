// Pairing without copying anything: computers on this network that a device can ask (watched only
// while a dialog shows them), and on the computer, the one nearby device asking it right now.

import type { P2pConfirmRequest, P2pNearbyComputer, P2pTransport } from "@stella/contracts/p2p";

const byName = (list: P2pNearbyComputer[]) => [...list].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export const createNearbyStore = (transport: P2pTransport) => {
  let found: P2pNearbyComputer[] = [];
  const watchers = new Set<() => void>();
  const notify = () => {
    for (const watcher of watchers) watcher();
  };

  transport.on((event) => {
    if (event.kind !== "nearby" || event.state === "ended") return;
    if (event.state === "found") {
      const { kind: _kind, state: _state, ...computer } = event;
      found = byName([...found.filter((c) => c.id !== computer.id), computer]);
    } else {
      found = found.filter((c) => c.id !== event.id);
    }
    notify();
  });

  return {
    get: () => found,
    watch(listener: () => void) {
      watchers.add(listener);
      if (watchers.size === 1) {
        void transport
          .command<P2pNearbyComputer[]>("nearby.start")
          .then((list) => {
            found = byName(list);
            notify();
          })
          .catch(() => undefined);
      }
      return () => {
        watchers.delete(listener);
        if (watchers.size > 0) return;
        found = [];
        void transport.command("nearby.stop").catch(() => undefined);
      };
    },
  };
};

export const createConfirmStore = (transport: P2pTransport) => {
  let current: P2pConfirmRequest | null = null;
  const listeners = new Set<() => void>();
  transport.on((event) => {
    if (event.kind !== "pairing") return;
    if (event.state === "confirm") {
      const { kind: _kind, state: _state, ...request } = event;
      current = request;
    } else if (event.state === "confirm_done" && current?.request === event.request) {
      current = null;
    } else {
      return;
    }
    for (const listener of listeners) listener();
  });
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
