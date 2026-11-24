import { networkInterfaces } from "node:os";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";

const POLL_MS = 1_000;

export type NetworkChange = { at: number; lost: boolean };

const listeners = new Set<(change: NetworkChange) => void>();
let addresses: ReadonlySet<string> = new Set();
let cancelPoll: (() => void) | null = null;

const routableAddresses = (): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.address.startsWith("169.254.") || /^fe[89ab]/i.test(entry.address)) continue;
      found.add(`${name} ${entry.address}`);
    }
  }
  return found;
};

const poll = (): void => {
  cancelPoll = forkTimeoutFiber(POLL_MS, poll);
  const before = addresses;
  addresses = routableAddresses();
  const lost = [...before].some((address) => !addresses.has(address));
  const gained = [...addresses].some((address) => !before.has(address));
  if (!lost && !gained) return;
  const change: NetworkChange = { at: Date.now(), lost };
  for (const listener of [...listeners]) listener(change);
};

export const watchNetwork = (listener: (change: NetworkChange) => void): (() => void) => {
  listeners.add(listener);
  if (!cancelPoll) {
    addresses = routableAddresses();
    cancelPoll = forkTimeoutFiber(POLL_MS, poll);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    cancelPoll?.();
    cancelPoll = null;
  };
};
