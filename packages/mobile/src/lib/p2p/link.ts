// This phone's direct device link (crate stella-p2p through modules/stella-p2p): the computers it
// paired to, kept current from the link's events. No account and no Stella server: the phone
// reaches each computer by key over Iroh. Mirrors desktop-rune/host/services/p2p/link.ts.

import { AppState, Platform } from "react-native";
import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import {
  P2P_CODE_PREFIX,
  P2P_URL_PREFIX,
  type P2pComputer,
  type P2pNodeEvent,
  type P2pTransport,
} from "@stella/contracts/p2p";
import {
  onStellaP2pEvent,
  startStellaP2p,
  stellaP2pAvailable,
  stellaP2pCommand,
} from "../../../modules/stella-p2p";

export { stellaP2pAvailable };

/** Set once this phone has paired, so the link comes up at launch only for people who use it. */
const PAIRED_KEY = "stella-p2p-paired-v1";

const deviceName = () => (Device.deviceName || Device.modelName || (Platform.OS === "ios" ? "iPhone" : "Phone")).trim();

let started: Promise<void> | null = null;

/** Short codes go through Stella's pairing mailbox; a dev build can point at its own. */
const rendezvous = process.env.EXPO_PUBLIC_STELLA_P2P_RENDEZVOUS?.trim();

const startLink = (): Promise<void> =>
  (started ??= startStellaP2p({
    name: deviceName(),
    platform: Platform.OS,
    relay: "default",
    // A phone is never anyone's computer, so it never answers nearby devices.
    discoverable: false,
    ...(rendezvous ? { rendezvous } : {}),
  }).catch((error: unknown) => {
    started = null;
    throw error;
  }));

export const p2pTransport: P2pTransport = {
  command: async <T>(name: string, args: Record<string, unknown> = {}) => {
    await startLink();
    return await stellaP2pCommand<T>(name, args);
  },
  on: (listener) => onStellaP2pEvent((event) => listener(event as P2pNodeEvent)),
};

type Raw = { computers: (Omit<P2pComputer, "link"> & { link?: P2pComputer["link"] })[] };

let computers: P2pComputer[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

let refreshing: Promise<void> | null = null;
let again = false;

export const refreshComputers = (): Promise<void> => {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = p2pTransport
    .command<Raw>("peers")
    .then((raw) => {
      computers = raw.computers.map((c) => ({ ...c, link: c.link ?? { state: "idle" } }));
      loaded = true;
      void AsyncStorage.setItem(PAIRED_KEY, computers.length > 0 ? "1" : "0").catch(() => undefined);
      notify();
    })
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
      if (again) {
        again = false;
        void refreshComputers();
      }
    });
  return refreshing;
};

let wired = false;
let booting: Promise<void> | null = null;

/** Starts the link and connects to every paired computer; safe to call again. */
export const bootDeviceLink = (): Promise<void> => {
  if (!stellaP2pAvailable) return Promise.resolve();
  if (!wired) {
    wired = true;
    p2pTransport.on((event) => {
      if (event.kind !== "computer") return;
      const { kind: _kind, id, name, ...link } = event;
      const known = computers.find((c) => c.id === id);
      if (known && link.state !== "paired" && link.state !== "forgotten") {
        computers = computers.map((c) =>
          c.id === id ? { ...c, ...(name ? { name } : {}), link: link as P2pComputer["link"] } : c,
        );
        notify();
        return;
      }
      void refreshComputers();
    });
    // iOS suspends the app's sockets in the background; coming back, reconnect at once instead
    // of waiting out the link's backoff.
    AppState.addEventListener("change", (state) => {
      if (state === "active" && started) void p2pTransport.command("computer.retry", {}).catch(() => undefined);
    });
  }
  booting ??= startLink()
    .then(refreshComputers)
    .then(() => {
      for (const computer of computers) {
        void p2pTransport.command("computer.connect", { id: computer.id }).catch(() => undefined);
      }
    })
    .catch((error: unknown) => {
      booting = null;
      throw error;
    });
  return booting;
};

/** At launch: brings the link up only when this phone has paired with a computer before. */
/** Starts the link when this phone has paired a computer before; says whether it has. */
export const resumeDeviceLinkIfPaired = async (): Promise<boolean> => {
  if (!stellaP2pAvailable) return false;
  if ((await AsyncStorage.getItem(PAIRED_KEY).catch(() => null)) !== "1") return false;
  void bootDeviceLink().catch(() => undefined);
  return true;
};

export const getComputers = () => computers;
export const getComputer = (id: string) => computers.find((c) => c.id === id) ?? null;

export const subscribeComputers = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useComputers = (): { computers: P2pComputer[]; loaded: boolean } => {
  const list = useSyncExternalStore(subscribeComputers, getComputers, getComputers);
  return { computers: list, loaded };
};

export const useComputer = (id: string | null | undefined): P2pComputer | null => {
  const list = useSyncExternalStore(subscribeComputers, getComputers, getComputers);
  return id ? (list.find((c) => c.id === id) ?? null) : null;
};

export const retryComputer = (id?: string) => {
  void p2pTransport.command("computer.retry", id ? { id } : {}).catch(() => undefined);
};

/** A short code a computer shows to be typed by hand: 7 Crockford base32 symbols, dash optional. */
const SHORT_CODE = /^[0-9A-HJKMNP-TV-Z]{7}$/;

export type PairInput = { kind: "code"; code: string } | { kind: "short"; code: string };

/** A pairing code as scanned, pasted or typed: `stella://p2p?c=…`, `stella-p2p1.…`, or `K7M-49PX`. */
export const parsePairInput = (raw: string): PairInput | null => {
  const text = raw.trim();
  if (!text) return null;
  const compact = text.replace(/\s+/g, "");
  if (compact.startsWith(P2P_CODE_PREFIX)) return { kind: "code", code: compact };
  if (/^stella:\/\/p2p\b/i.test(compact)) {
    const query = compact.slice(compact.indexOf("?") + 1);
    const param = query
      .split("&")
      .map((pair) => pair.split("="))
      .find(([key]) => key === "c")?.[1];
    let code = "";
    try {
      code = param ? decodeURIComponent(param) : "";
    } catch {
      code = param ?? "";
    }
    return code.startsWith(P2P_CODE_PREFIX) ? { kind: "code", code } : null;
  }
  // Crockford: O reads as 0, I and L as 1.
  const short = compact.replace(/-/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return SHORT_CODE.test(short) ? { kind: "short", code: `${short.slice(0, 3)}-${short.slice(3)}` } : null;
};

export const pairingUrl = (code: string) => `${P2P_URL_PREFIX}${code}`;

/** Pairs with the computer whose code this is and waits for it to come online (or 15 s). */
export const pairWithComputer = async (input: PairInput): Promise<P2pComputer> => {
  await bootDeviceLink();
  const paired = await p2pTransport.command<{ id: string }>(input.kind === "short" ? "pair.short" : "pair", {
    code: input.code,
  });
  await refreshComputers();
  await AsyncStorage.setItem(PAIRED_KEY, "1").catch(() => undefined);
  await new Promise<void>((done) => {
    const isOnline = () => getComputer(paired.id)?.link.state === "online";
    if (isOnline()) return done();
    const timer = setTimeout(finish, 15_000);
    const unsubscribe = subscribeComputers(() => {
      if (isOnline()) finish();
    });
    function finish() {
      clearTimeout(timer);
      unsubscribe();
      done();
    }
  });
  const computer = getComputer(paired.id);
  if (!computer) throw new Error("Pairing didn't finish.");
  return computer;
};

export const forgetComputer = async (id: string): Promise<void> => {
  await p2pTransport.command("computer.forget", { id });
  await refreshComputers();
};
