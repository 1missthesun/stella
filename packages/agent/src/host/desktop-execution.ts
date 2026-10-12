/**
 * Where a desktop conversation's Stella runs. Everything the conversation
 * does here runs on this computer; an agent meant for another computer or
 * the cloud runs there as a whole (`desktop-agents`).
 *
 * In a conversation stored in the cloud Stella can move herself
 * (`switch_destination`): the conversation's object records the new host
 * (`@stella/contracts/turn-plane/pi-brain`), and once her turn here ends
 * her brief continues there as a placed chat.
 */
import type { Context } from "@earendil-works/chord";
import { samePiBrainHost, type PiBrainHost, type PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import {
  DEVICES_PATH,
  findDeviceDestination,
  type DeviceDestination,
  type DevicesResponse,
} from "@stella/contracts/turn-plane/placement";
import { deviceRefusal, deviceStanding, type StellaExecutionHost } from "../stella/execution.ts";
import type { StellaPlacement } from "../stella/placement.ts";

const LIST_TIMEOUT_MS = 15_000;

/** The owner's computers, as the owner gate lists them, for one conversation stored in the cloud. */
export type DesktopDevices = { devices(): Promise<DeviceDestination[]> };

/** The owner's computers over HTTP with the user's sign-in; undefined for a conversation kept on this computer. */
export const httpDevices = (
  conversationId: string,
  auth: () => { baseUrl: string; authToken: string } | null | undefined,
): DesktopDevices | undefined => {
  if (conversationId.startsWith("local_")) return undefined;
  return {
    devices: async () => {
      const current = auth();
      if (!current) throw new Error("Sign in to Stella to reach your other computers.");
      const response = await fetch(`${current.baseUrl.replace(/\/+$/, "")}${DEVICES_PATH}`, {
        headers: { authorization: `Bearer ${current.authToken}` },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Listing your computers failed (${response.status}).`);
      return ((await response.json()) as DevicesResponse).devices ?? [];
    },
  };
};

/** Where a conversation stored in the cloud has its brain, as its object records it. */
export type DesktopBrain = {
  read(): Promise<PiBrainRecord | null>;
  set(host: PiBrainHost): Promise<PiBrainRecord>;
  /** Carry on at `host` with Stella's brief, as a chat placed there. */
  handOff(host: PiBrainHost, brief: string): Promise<void>;
  /**
   * What Stella reads hidden (an agent's report or note), placed at `host`,
   * where she runs; once per `id`. False when that host can't take it now
   * (out of reach, not ready), for this computer to take instead.
   */
  note(host: PiBrainHost, note: { id: string; text: string }): Promise<boolean>;
  /** The account's home computer, where Stella stays while it is up; null clears it. */
  setHome?(deviceId: string | null): Promise<void>;
};

/** One conversation's execution host on this computer: where Stella can move herself. */
export function desktopExecution(options: {
  /** This computer: naming it keeps Stella here. */
  deviceId?: string;
  /** Kept on this computer only: Stella never moves. */
  localOnly: boolean;
  devices?: DesktopDevices;
  /** Where the conversation's brain runs, for a conversation stored in the cloud. */
  brain?: DesktopBrain;
  /** Settles once Stella's turn here has ended, so her brief continues after it. */
  turnEnded?(): Promise<void>;
  /** The record the conversation's object took for a move. */
  brainMoved?(record: PiBrainRecord): void;
  report(error: unknown): void;
}) {
  const isHere = (target: StellaPlacement): boolean =>
    target.kind === "local" || (target.kind === "device" && target.deviceId === options.deviceId);

  /** The brain record names `next` from now on: that host takes the conversation's turns. */
  const setBrain = async (brain: DesktopBrain, next: PiBrainHost): Promise<PiBrainRecord> => {
    const record = await brain.set(next);
    options.brainMoved?.(record);
    return record;
  };

  /** The cloud, or another computer that can take work now. */
  const brainHostAt = async (target: StellaPlacement): Promise<{ placement: StellaPlacement; next: PiBrainHost } | { error: string }> => {
    if (isHere(target)) return { error: "You already run on this computer." };
    if (!options.devices) return { error: "Sign in to Stella to move away from this computer." };
    if (target.kind === "cloud") return { placement: target, next: { host: "cloud" } };
    if (target.kind !== "device") return { error: "You already run on this computer." };
    const listed = await options.devices.devices().catch(() => undefined);
    if (!listed) return { error: "Couldn't read the connected devices list right now. Try again in a moment." };
    const device = findDeviceDestination(listed, target.deviceId);
    if (!device) {
      return { error: `No connected device has the device_id or name ${target.deviceId}. Use a device_id from the connected devices list, or "cloud".` };
    }
    if (device.deviceId === options.deviceId) return { error: "You already run on this computer." };
    const name = device.label?.trim() || device.deviceId;
    const refusal = deviceRefusal(device, name);
    if (refusal) return { error: refusal };
    return {
      placement: { kind: "device", deviceId: device.deviceId, label: name },
      next: { host: "device", deviceId: device.deviceId, label: name },
    };
  };

  const host: StellaExecutionHost = {
    standing: async (deviceId) => {
      const listed = await options.devices?.devices().catch(() => undefined);
      const device = listed?.find((entry) => entry.deviceId === deviceId);
      return device ? deviceStanding(device) : undefined;
    },
    ...(options.brain && !options.localOnly
      ? {
          moveBrain: async (target, brief) => {
            const at = await brainHostAt(target);
            if ("error" in at) return at;
            const brain = options.brain!;
            await setBrain(brain, at.next);
            void (async () => {
              await options.turnEnded?.();
              await brain.handOff(at.next, brief);
            })().catch((error: unknown) => options.report(error));
            return { moved: at.placement };
          },
        }
      : {}),
  };

  /**
   * The user moving Stella from the app's picker: the same move as her own,
   * with no brief to hand on, since the user's next message continues
   * there. This computer is a host like any other: picking it keeps her here
   * for every device's messages.
   */
  const pinBrain = async (target: StellaPlacement, _context: Context): Promise<PiBrainRecord | { error: string }> => {
    const brain = options.brain;
    if (!brain || options.localOnly) return { error: "This chat is stored only on this computer, so it can only run here." };
    // The computer the user picks is the account's home computer from now
    // on: Stella comes back to it whenever it is up. Picking the cloud clears it.
    const home = async (record: PiBrainRecord): Promise<PiBrainRecord> => {
      await brain.setHome?.(record.host === "device" ? record.deviceId : null);
      return record;
    };
    // Already there: only the home computer changes, and the lease keeps its epoch.
    const settle = async (next: PiBrainHost): Promise<PiBrainRecord> => {
      const current = await brain.read().catch(() => null);
      return await home(current && samePiBrainHost(current, next) ? current : await setBrain(brain, next));
    };
    if (!isHere(target)) {
      const at = await brainHostAt(target);
      if ("error" in at) return at;
      return await settle(at.next);
    }
    if (!options.deviceId) return { error: "This computer has no device id yet. Try again in a moment." };
    const listed = await options.devices?.devices().catch(() => undefined);
    const label = listed?.find((entry) => entry.deviceId === options.deviceId)?.label?.trim();
    return await settle({ host: "device", deviceId: options.deviceId, ...(label ? { label } : {}) });
  };

  return { host, pinBrain };
}

export type DesktopExecution = ReturnType<typeof desktopExecution>;
