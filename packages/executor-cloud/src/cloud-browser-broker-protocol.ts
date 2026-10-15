import type { CloudBrowserHandoffResult } from "@stella/contracts/cloud-browser";

export const CLOUD_BROWSER_BROKER_PATH = "/api/cloud/browser";

/** How long one handoff wait request is held open before answering `waiting`. */
export const CLOUD_BROWSER_HANDOFF_POLL_MS = 20_000;

export type CloudBrowserBrokerRequest =
  | { turnId: string; op: "call"; method: string; args: unknown[] }
  | { turnId: string; op: "wait"; interactionId: string }
  | { turnId: string; op: "cancel"; interactionId: string }
  | { turnId: string; op: "checkpoint" };

export type CloudBrowserBrokerResponse =
  | { ok: true; value: unknown }
  | {
      ok: true;
      handoff: { interactionId: string; displayOrigin: string; expiresAt: number };
    }
  | { ok: true; waiting: true }
  | { ok: true; ended: { result: CloudBrowserHandoffResult; message: string } }
  | { ok: false; error: string };
