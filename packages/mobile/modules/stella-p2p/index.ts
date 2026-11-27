// The phone's side of Stella's direct device link (crate stella-p2p, see ios/ and android/).
// `null` when this binary was built without the module (an OTA update reaching an older build).

import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

type NativeStellaP2p = {
  start(configJson: string): Promise<void>;
  command(name: string, argsJson: string): Promise<string>;
  stop(): Promise<void>;
  addListener(event: "onEvent", listener: (event: { json: string }) => void): EventSubscription;
};

const native = requireOptionalNativeModule<NativeStellaP2p>("StellaP2p");

export const stellaP2pAvailable = native !== null;

const required = (): NativeStellaP2p => {
  if (!native) throw new Error("This version of the app can't connect to a computer directly.");
  return native;
};

/** `{name, platform, relay?, dataDir?}`; the data dir defaults to the app's private storage. */
export const startStellaP2p = (config: Record<string, unknown>): Promise<void> =>
  required().start(JSON.stringify(config));

/** One crate command (`pair`, `peers`, `request`, …); rejects with the crate's error. */
export const stellaP2pCommand = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const reply = JSON.parse(await required().command(name, JSON.stringify(args))) as
    | { ok: true; value: T }
    | { ok: false; error?: string };
  if (!reply.ok) throw new Error(reply.error || `${name} failed`);
  return reply.value;
};

export const stopStellaP2p = (): Promise<void> => required().stop();

/** The node's events (crate `kind`s: request, event, device, computer, pairing, error). */
export const onStellaP2pEvent = (listener: (event: Record<string, unknown>) => void): (() => void) => {
  if (!native) return () => {};
  const subscription = native.addListener("onEvent", ({ json }) => {
    try {
      listener(JSON.parse(json) as Record<string, unknown>);
    } catch {}
  });
  return () => subscription.remove();
};
