import type { PairingStatusResponse, ServerDiscovery } from "../self-host.js";

/** Which Stella server this desktop install talks to. */
export type DesktopServerState = {
  /** The launcher reads `server.json`, so this desktop can switch servers. */
  canSwitch: boolean;
  /** This install runs against a self-hosted server picked by pairing. */
  selfHosted: boolean;
  serverId: string | null;
  name: string | null;
  backendUrl: string | null;
};

export type SelfHostInspectResult =
  | { ok: true; server: string; discovery: ServerDiscovery }
  | { ok: false; error: string };

export type SelfHostConnectResult =
  | { ok: true; relaunching: boolean }
  | { ok: false; error: string };

export type SelfHostPairingStartResult =
  | { ok: true; pairingId: string; link: string; expiresAt: number }
  | { ok: false; error: string };

export type SelfHostPairingStatusResult =
  | ({ ok: true } & PairingStatusResponse)
  | { ok: false; error: string };
