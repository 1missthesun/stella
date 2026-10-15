import type { PairingStatusResponse, ServerDiscovery } from "../self-host.js";

export type DesktopServerState = {
  canSwitch: boolean;
  selfHosted: boolean;
  serverId: string | null;
  name: string | null;
  backendUrl: string | null;
};

export const DESKTOP_HOSTED_SERVER_ID = "hosted";

export type DesktopServerEntry = {
  id: string;
  kind: "hosted" | "self-hosted";
  name: string;
  origin: string | null;
  active: boolean;
  signedIn: boolean;
};

export type SelfHostSwitchResult =
  | { ok: true; relaunching: boolean }
  | { ok: false; reason: "needs_pairing" | "error"; error: string };

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
